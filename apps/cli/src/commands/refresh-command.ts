import { join } from 'node:path';
import { defaultOutput } from '../cli-output.ts';
import type { CliCommandResult, CliOutput } from '../cli-output.ts';
import { manifestPath, pathExists } from '../workspace-paths.ts';

export type RefreshCommandOptions = {
  configPath?: string;
  refresh?: (input: { configPath?: string; workspaceDir: string }) => Promise<{
    assetRefresh: { files?: readonly string[]; reason?: string; status: 'refreshed' | 'skipped' };
    changedPages: readonly {
      action: string;
      findings: readonly { message: string; severity: string }[];
      id: string;
      reasons: readonly string[];
    }[];
    manifest: { pages: readonly unknown[] };
  }>;
  workspaceDir?: string;
};

export const runRefreshCommand = async (
  options: RefreshCommandOptions = {},
  output: CliOutput = defaultOutput
): Promise<CliCommandResult> => {
  const workspaceDir = options.workspaceDir ?? process.cwd();
  const configPath = options.configPath ?? 'docstube.yml';
  if (!(await pathExists(join(workspaceDir, configPath)))) {
    output.error(`No ${configPath} found. Run docstube wizard first.`);
    return { exitCode: 1 };
  }

  const path = manifestPath(workspaceDir);
  if (!(await pathExists(path))) {
    output.error('No .docstube/manifest.yml found. Run docstube generate first.');
    return { exitCode: 1 };
  }

  const refresh = options.refresh ?? (await import('@docstube/core')).refreshProjectDocumentation;
  const result = await refresh({ configPath, workspaceDir });
  output.info(`Loaded manifest with ${result.manifest.pages.length} pages.`);
  if (result.changedPages.length === 0) {
    output.info('No stale pages found.');
  } else {
    for (const page of result.changedPages) {
      output.info(`${page.action}: ${page.id} (${page.reasons.join(', ')})`);
      for (const finding of page.findings) {
        output.error(`${finding.severity}: ${finding.message}`);
      }
    }
  }
  output.info(
    result.assetRefresh.status === 'refreshed'
      ? `Refreshed ${result.assetRefresh.files?.length ?? 0} vendored asset files.`
      : `Vendored assets: skipped (${result.assetRefresh.reason}).`
  );
  return { exitCode: 0 };
};
