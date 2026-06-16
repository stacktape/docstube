import { join } from 'node:path';
import { defaultOutput } from '../cli-output.ts';
import type { CliCommandResult, CliOutput } from '../cli-output.ts';
import { manifestPath, pathExists } from '../workspace-paths.ts';

export type StatusCommandOptions = {
  configPath?: string;
  workspaceDir?: string;
};

export const runStatusCommand = async (
  options: StatusCommandOptions = {},
  output: CliOutput = defaultOutput
): Promise<CliCommandResult> => {
  const workspaceDir = options.workspaceDir ?? process.cwd();
  const configPath = options.configPath ?? 'docstube.yml';
  const hasConfig = await pathExists(join(workspaceDir, configPath));
  const hasManifest = await pathExists(manifestPath(workspaceDir));

  output.info(`Config: ${hasConfig ? 'found' : 'missing'} (${configPath})`);
  output.info(`Manifest: ${hasManifest ? 'found' : 'missing'}`);

  if (hasManifest) {
    const { readManifestFile } = await import('@docstube/core');
    const manifest = await readManifestFile(manifestPath(workspaceDir));
    const counts = new Map<string, number>();
    for (const page of manifest.pages) {
      counts.set(page.status, (counts.get(page.status) ?? 0) + 1);
    }
    const summary =
      counts.size === 0 ? '0 pages' : [...counts.entries()].map(([status, count]) => `${status}:${count}`).join(', ');
    output.info(`Pages: ${summary}`);
    output.info(`Generated with: ${manifest.generatedWith.name} ${manifest.generatedWith.version}`);
  }

  return { exitCode: 0 };
};
