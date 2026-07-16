import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PageArtifact } from '@docstube/plugin-sdk';
import {
  CoreError,
  createManifestStore,
  createPluginHost,
  errorFindings,
  loadConfigFamily,
  loadConfiguredPlugins,
  registerBuiltinPlugins,
  runVerifiers
} from '@docstube/core';
import { buildCodemap } from '@docstube/codemap';
import type { CliCommandResult, CliOutput } from '../cli-output.ts';

// `check` kinds derive from registered verifier plugins — an open enum, never a hardcoded list
// (PRODUCT §4.1). `--list` shows what is available in THIS project (plugins included).

export type CheckCommandInput = {
  workspaceDir: string;
  kind?: string | undefined;
  list?: boolean | undefined;
};

export const runCheckCommand = async (input: CheckCommandInput, output: CliOutput): Promise<CliCommandResult> => {
  try {
    const family = await loadConfigFamily(input.workspaceDir);
    const host = createPluginHost();
    await registerBuiltinPlugins(host);
    await loadConfiguredPlugins(host, family.config, input.workspaceDir);

    const kinds = host.verifiers().map((entry) => entry.definition.id);
    if (input.list === true) {
      for (const entry of host.verifiers()) {
        output.info(`${entry.definition.id} — ${entry.definition.title} (${entry.plugin.plugin.manifest.name})`);
      }
      return { exitCode: 0 };
    }
    if (input.kind !== undefined && !kinds.includes(input.kind)) {
      output.error(`unknown check "${input.kind}" — available: ${kinds.join(', ')}`);
      return { exitCode: 1 };
    }

    const store = createManifestStore(input.workspaceDir, family.config.versions.current);
    const index = await store.readIndex();
    if (index === undefined) {
      output.error('No manifest — run `docstube generate` before `docstube check`.');
      return { exitCode: 1 };
    }
    const locale = family.config.locales.source;
    const artifacts: PageArtifact[] = [];
    for (const entry of index.pages) {
      const shard = await store.readPageShard({ locale, pageId: entry.id });
      if (shard === undefined) {
        output.error(`shard missing for ${entry.slug}`);
        return { exitCode: 1 };
      }
      const mdx = await readFile(join(input.workspaceDir, family.config.outDir, entry.path), 'utf8');
      artifacts.push({ page: shard.page, mdx, mdxPath: entry.path, locale, version: shard.version });
    }

    const codemap = await buildCodemap({
      repoRoot: input.workspaceDir,
      commit: index.versions.find((version) => version.status === 'current')?.commit ?? '0'.repeat(40),
      packs: host.languagePacks().map((entry) => entry.definition)
    });

    const results = await runVerifiers({
      repoRoot: input.workspaceDir,
      config: family.config,
      codemap,
      glossary: family.glossary,
      host,
      artifacts,
      includeSiteScope: true
    });
    const selected = input.kind === undefined ? results : results.filter((result) => result.verifier === input.kind);
    for (const result of selected) {
      output.info(`${result.verifier}: ${result.status} (${result.findings.length} finding(s))`);
      for (const finding of result.findings) {
        output.info(`  [${finding.severity}] ${finding.message}${finding.file ? ` (${finding.file})` : ''}`);
      }
    }
    return { exitCode: errorFindings(selected).length > 0 ? 1 : 0 };
  } catch (error) {
    if (error instanceof CoreError) {
      output.error(error.message);
      return { exitCode: 1 };
    }
    throw error;
  }
};
