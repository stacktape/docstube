import type { OpenBrowser, StartedLocalControlPlane } from '@docstube/core';
import { defaultOutput } from '../cli-output.ts';
import type { CliCommandResult, CliOutput } from '../cli-output.ts';
import { deleteMachineState, pathExists, stateFiles } from '../workspace-paths.ts';

export type StartControlPlane = (options: {
  openBrowser?: OpenBrowser;
  uiDevServerUrl?: string;
  workspaceDir?: string;
}) => Promise<StartedLocalControlPlane>;

export type WizardCommandOptions = {
  fresh?: boolean;
  openBrowser?: OpenBrowser;
  start?: StartControlPlane;
  uiDevServerUrl?: string;
  workspaceDir?: string;
};

export const runWizardCommand = async (
  options: WizardCommandOptions = {},
  output: CliOutput = defaultOutput
): Promise<CliCommandResult> => {
  const workspaceDir = options.workspaceDir ?? process.cwd();
  const existingState = await pathExists(stateFiles(workspaceDir)[0]!);

  if (options.fresh) {
    await deleteMachineState(workspaceDir);
    output.info('Discarded local wizard state.');
  } else if (existingState) {
    output.info('Resuming existing local wizard state.');
  }

  const start = options.start ?? (await import('@docstube/core')).startGenerateSession;
  const started = await start({
    workspaceDir,
    openBrowser: options.openBrowser,
    uiDevServerUrl: options.uiDevServerUrl
  });
  output.info(`Started local control plane: ${started.url}`);
  return { exitCode: 0 };
};
