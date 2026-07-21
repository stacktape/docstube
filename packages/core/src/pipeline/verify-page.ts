import type { PageArtifact, PluginExec, PluginFs, VerifierContext, VerifierDefinition } from '@docstube/plugin-sdk';
import type { Codemap, DocstubeConfig, Finding, Glossary, VerifierRunResult } from '@docstube/contracts';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve as resolvePath } from 'node:path';
import { spawn } from 'node:child_process';
import type { PluginHost } from '../plugins/plugin-host.ts';
import { createBlockRegistry } from '../entities/block-registry.ts';

// The verify stage: run every applicable registered verifier over the page artifacts. Trust state
// is owned by the claim ledger (verify-claims.ts assigns per-claim correctness from verifier
// results); the legacy proven/scored/out-of-domain guarantee ladder is gone from the live
// pipeline — reader surfaces project claim counts from ClaimEvidence instead.

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
