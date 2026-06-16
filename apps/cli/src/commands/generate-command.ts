import { join } from 'node:path';
import { defaultOutput } from '../cli-output.ts';
import type { CliCommandResult, CliOutput } from '../cli-output.ts';
import { deleteMachineState, pathExists, stateFiles } from '../workspace-paths.ts';

export type GenerateCommandOptions = {
  configPath?: string;
  fresh?: boolean;
  workspaceDir?: string;
};

export const runGenerateCommand = async (
  options: GenerateCommandOptions = {},
  output: CliOutput = defaultOutput
): Promise<CliCommandResult> => {
  const workspaceDir = options.workspaceDir ?? process.cwd();
  const configPath = options.configPath ?? 'docstube.yml';

  if (!(await pathExists(join(workspaceDir, configPath)))) {
    output.error(`No ${configPath} found. Run docstube wizard first.`);
    return { exitCode: 1 };
  }

  if (options.fresh) {
    await deleteMachineState(workspaceDir);
    output.info('Discarded local generation state.');
  } else if (await pathExists(stateFiles(workspaceDir)[0]!)) {
    output.info('Resuming existing local generation state.');
  }

  const { initializeProjectGeneration } = await import('@docstube/core');
  const result = await initializeProjectGeneration({ configPath, workspaceDir });
  output.info(`${result.resumed ? 'Resumed' : 'Initialized'} ${result.pagesCount} pages for ${result.runId}.`);
  output.info('Generation pipeline is queued from config; page writing is implemented by the pipeline tasks.');
  return { exitCode: 0 };
};
