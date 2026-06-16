import { join } from 'node:path';
import { defaultOutput } from '../cli-output.ts';
import type { CliCommandResult, CliOutput } from '../cli-output.ts';
import { manifestPath, pathExists } from '../workspace-paths.ts';

export type RefineCommandOptions = {
  configPath?: string;
  failed?: boolean;
  maxRounds?: number;
  target?: string;
  workspaceDir?: string;
};

export const runRefineCommand = async (
  options: RefineCommandOptions = {},
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
  const target = options.target ? ` for ${options.target}` : '';
  const rounds = options.maxRounds ? ` up to ${options.maxRounds} rounds` : '';
  const scope = options.failed ? 'failed pages' : 'the lowest quality scores';
  output.info(`Loaded manifest with ${manifest.pages.length} pages.`);
  output.info(`Refinement will prioritize ${scope} first${target}${rounds}.`);
  output.error('The score-driven refinement pipeline is not implemented yet.');
  return { exitCode: 1 };
};
