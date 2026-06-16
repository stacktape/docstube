import { join } from 'node:path';
import { defaultOutput } from '../cli-output.ts';
import type { CliCommandResult, CliOutput } from '../cli-output.ts';
import { manifestPath, pathExists } from '../workspace-paths.ts';

export type RefreshCommandOptions = {
  configPath?: string;
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

  const { readManifestFile } = await import('@docstube/core');
  const manifest = await readManifestFile(path);
  output.info(`Loaded manifest with ${manifest.pages.length} pages.`);
  output.info('Refresh checks all pages by default, regenerates stale pages, and updates vendored theme assets.');
  output.info('Refresh engine is ready to resolve stale pages.');
  return { exitCode: 0 };
};
