import type { PageArtifact, PluginExec, PluginFs, VerifierContext, VerifierDefinition } from '@docstube/plugin-sdk';
import type {
  BlockEntity,
  Codemap,
  DocstubeConfig,
  Finding,
  Glossary,
  GuaranteeLevel,
  PageEntity,
  VerifierRunResult
} from '@docstube/contracts';
import { rollUpGuarantee } from '@docstube/contracts';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve as resolvePath } from 'node:path';
import { spawn } from 'node:child_process';
import type { PluginHost } from '../plugins/plugin-host.ts';
import { createBlockRegistry } from '../entities/block-registry.ts';

// The verify stage: run every applicable registered verifier over the page artifacts, then assign
// guarantee levels from the results (computed, never asserted — ARCHITECTURE.md §4).

const createPluginFs = (repoRoot: string, writableRoots: string[]): PluginFs => ({
  readFile: (path) => readFile(join(repoRoot, path), 'utf8'),
  exists: async (path) => {
    try {
      await access(join(repoRoot, path));
      return true;
    } catch {
      return false;
    }
  },
  writeFile: async (path, content) => {
    // Accidental-escape protection on RESOLVED paths ('cache/../../x' must not pass a prefix
    // check). Not a security boundary: plugins are in-process JS (ARCHITECTURE.md §6.3
    // honest-but-soft enforcement) — this catches bugs, not malice.
    const target = resolvePath(repoRoot, path);
    const allowed = writableRoots.some((root) => {
      const resolvedRoot = resolvePath(repoRoot, root);
      const relativePath = relative(resolvedRoot, target);
      return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
    });
    if (!allowed) {
      throw new Error(`plugin write to "${path}" is outside its declared writableRoots [${writableRoots.join(', ')}]`);
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');
  }
});

const createPluginExec =
  (allowedExecutables: string[]): PluginExec =>
  (command, args, options) => {
    if (!allowedExecutables.includes(command)) {
      return Promise.reject(
        new Error(
          `plugin exec of "${command}" is not in its declared permissions.exec [${allowedExecutables.join(', ')}]`
        )
      );
    }
    return new Promise((resolve, reject) => {
      // env passthrough is the snippet-exec scrub seam: when a verifier supplies an explicit env,
      // the child sees ONLY that (secrets stay out of model-authored snippets by default).
      const child = spawn(command, args, { cwd: options?.cwd, shell: false, env: options?.env ?? process.env });
      let stdout = '';
      let stderr = '';
      const timeout = options?.timeoutMs
        ? setTimeout(() => {
            child.kill();
            reject(new Error(`exec of "${command}" timed out after ${options.timeoutMs}ms`));
          }, options.timeoutMs)
        : undefined;
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on('error', (error) => {
        if (timeout) clearTimeout(timeout);
        reject(error);
      });
      child.on('close', (exitCode) => {
        if (timeout) clearTimeout(timeout);
        resolve({ exitCode: exitCode ?? -1, stdout, stderr });
      });
      if (options?.input !== undefined) {
        child.stdin.write(options.input);
      }
      child.stdin.end();
    });
  };

export type VerifyStageInput = {
  repoRoot: string;
  config: DocstubeConfig;
  codemap: Codemap;
  glossary: Glossary;
  host: PluginHost;
  artifacts: PageArtifact[];
  // 'page' runs block+page verifiers per artifact; 'site' additionally runs site-scope verifiers.
  includeSiteScope: boolean;
};

const verifierApplies = (definition: VerifierDefinition, artifacts: PageArtifact[]): boolean => {
  const appliesTo = definition.appliesTo;
  if (!appliesTo) {
    return true;
  }
  const blocks = artifacts.flatMap((artifact) => [
    ...artifact.page.preamble,
    ...artifact.page.sections.flatMap((section) => section.blocks)
  ]);
  return blocks.some(
    (block) =>
      (appliesTo.blockTypes === undefined || appliesTo.blockTypes.includes(block.blockType)) &&
      (appliesTo.languages === undefined ||
        (block.language !== undefined && appliesTo.languages.includes(block.language)))
  );
};

export const runVerifiers = async (input: VerifyStageInput): Promise<VerifierRunResult[]> => {
  const registry = createBlockRegistry(input.host.components().map((entry) => entry.definition));
  const results: VerifierRunResult[] = [];
  for (const { definition, plugin } of input.host.verifiers()) {
    if (definition.scope === 'site' && !input.includeSiteScope) {
      continue;
    }
    // i18n semantics (PRODUCT §7.8): source-only verifiers (code checks) never run on
    // translations; per-locale verifiers (structure, links, prose) run on every locale.
    const scopedArtifacts =
      definition.localeScope === 'per-locale'
        ? input.artifacts
        : input.artifacts.filter((artifact) => artifact.locale === input.config.locales.source);
    if (scopedArtifacts.length === 0 || !verifierApplies(definition, scopedArtifacts)) {
      continue;
    }
    const ctx: VerifierContext = {
      repoRoot: input.repoRoot,
      config: input.config,
      codemap: input.codemap,
      glossary: input.glossary,
      registry,
      fs: createPluginFs(input.repoRoot, plugin.plugin.manifest.permissions.writableRoots),
      exec: createPluginExec(plugin.plugin.manifest.permissions.exec),
      logger: { info: (message) => console.info(message), warn: (message) => console.warn(message) }
    };
    const started = Date.now();
    try {
      const result = await definition.verify(ctx, scopedArtifacts);
      results.push({ ...result, durationMs: Date.now() - started });
    } catch (error) {
      // Verifiers must not take a run down: an internal crash is an 'error' result, surfaced.
      results.push({
        verifier: definition.id,
        plugin: plugin.plugin.manifest.name,
        status: 'error',
        findings: [
          {
            source: 'verifier',
            check: definition.id,
            severity: 'error',
            message: `verifier crashed: ${(error as Error).message}`
          }
        ],
        coveredEntityIds: [],
        durationMs: Date.now() - started
      });
    }
  }
  return results;
};

export const errorFindings = (results: VerifierRunResult[]): Finding[] =>
  results.flatMap((result) => result.findings.filter((finding) => finding.severity === 'error'));

// Guarantee assignment: entities covered by a passing PROVING verifier become proven; entities
// named by an out-of-domain-capping warning stay capped. Everything else keeps 'scored'.
export const assignGuarantees = (page: PageEntity, results: VerifierRunResult[], host: PluginHost): PageEntity => {
  const provenIds = new Set<string>();
  const provingVerifierIds = new Set(
    host
      .verifiers()
      .filter((entry) => entry.definition.proves)
      .map((entry) => entry.definition.id)
  );
  for (const result of results) {
    if (result.status === 'pass' && provingVerifierIds.has(result.verifier)) {
      for (const id of result.coveredEntityIds) {
        provenIds.add(id);
      }
    }
  }
  // One prover passing never outweighs another failing: an entity named by any error finding is
  // not proven (e.g. a snippet that executes after type-erasure but fails the typecheck).
  for (const result of results) {
    for (const finding of result.findings) {
      if (finding.severity === 'error' && finding.entity?.entityId !== undefined) {
        provenIds.delete(finding.entity.entityId);
      }
    }
  }

  const upgradeBlock = (block: BlockEntity): BlockEntity => {
    const guarantee: GuaranteeLevel = provenIds.has(block.id) ? 'proven' : block.guarantee;
    return {
      ...block,
      guarantee,
      claims: block.claims.map((claim) => (provenIds.has(claim.id) ? { ...claim, guarantee: 'proven' } : claim))
    };
  };

  return recomputeRollups({
    ...page,
    preamble: page.preamble.map(upgradeBlock),
    sections: page.sections.map((section) => ({ ...section, blocks: section.blocks.map(upgradeBlock) }))
  });
};

// Provable entities: code fences (verifier domain) and claim-bearing prose (grounding domain).
// Claimless narrative and declared out-of-domain blocks are excluded from the roll-up, so a
// parent's "proven" means "everything provable underneath is proven" — the honest reading of the
// badge (founder decision 2026-07-17). ODD stays visible per-block and through flags.
const isProvable = (block: BlockEntity): boolean => block.blockType === 'code-example' || block.claims.length > 0;

const provableLevels = (blocks: readonly BlockEntity[]): GuaranteeLevel[] =>
  blocks.filter((block) => isProvable(block) && block.guarantee !== 'out-of-domain').map((block) => block.guarantee);

export const recomputeRollups = (page: PageEntity): PageEntity => {
  const sections = page.sections.map((section) => ({
    ...section,
    guarantee: rollUpGuarantee(provableLevels(section.blocks))
  }));
  return {
    ...page,
    sections,
    guarantee: rollUpGuarantee([
      ...provableLevels(page.preamble),
      // Sections with nothing provable are transparent to the page level.
      ...sections.filter((section) => provableLevels(section.blocks).length > 0).map((section) => section.guarantee)
    ])
  };
};

const liftBlock = (block: BlockEntity): BlockEntity =>
  block.guarantee === 'scored' && block.claims.length > 0 && block.claims.every((claim) => claim.guarantee === 'proven')
    ? { ...block, guarantee: 'proven' }
    : block;

// After the claims stage grounds a page's claims, a prose block whose EVERY claim grounded
// becomes proven itself (grounding = proven, the deterministic lane). Callers invoke this only on
// the clean path — no error findings exist, so no demotion cross-check is needed here.
export const liftClaimGroundedBlocks = (page: PageEntity): PageEntity =>
  recomputeRollups({
    ...page,
    preamble: page.preamble.map(liftBlock),
    sections: page.sections.map((section) => ({ ...section, blocks: section.blocks.map(liftBlock) }))
  });
