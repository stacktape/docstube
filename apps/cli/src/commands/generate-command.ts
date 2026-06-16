import { join } from 'node:path';
import { defaultOutput } from '../cli-output.ts';
import type { CliCommandResult, CliOutput } from '../cli-output.ts';
import { deleteMachineState, pathExists, stateFiles } from '../workspace-paths.ts';

export type GenerateCommandOptions = {
  configPath?: string;
  fresh?: boolean;
  generate?: (input: { configPath?: string; workspaceDir: string }) => Promise<{
    generatedPages: readonly { path: string; status: string }[];
    manifestPath: string;
    pagesCount: number;
    resumed: boolean;
    runId: string;
    sourceFilesCount: number;
  }>;
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

  const generate = options.generate ?? (await import('@docstube/core')).generateProjectDocumentation;
  const result = await generate({ configPath, workspaceDir });
  output.info(`${result.resumed ? 'Resumed' : 'Generated'} ${result.pagesCount} pages for ${result.runId}.`);
  output.info(`Wrote manifest: ${result.manifestPath}`);
  output.info(`Source files considered: ${result.sourceFilesCount}`);
  for (const page of result.generatedPages) {
    output.info(`${page.status}: ${page.path}`);
  }
  return { exitCode: 0 };
};
