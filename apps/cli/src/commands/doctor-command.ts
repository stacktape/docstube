import { join } from 'node:path';
import { defaultOutput } from '../cli-output.ts';
import type { CliCommandResult, CliOutput } from '../cli-output.ts';
import { pathExists } from '../workspace-paths.ts';
import { runValidateCommand } from './validate-command.ts';

export type DoctorCommandOptions = {
  configPath?: string;
  workspaceDir?: string;
};

export const runDoctorCommand = async (
  options: DoctorCommandOptions = {},
  output: CliOutput = defaultOutput
): Promise<CliCommandResult> => {
  const workspaceDir = options.workspaceDir ?? process.cwd();
  const configPath = options.configPath ?? 'docstube.yml';
  output.info(`Node: ${process.version}`);
  output.info(`Platform: ${process.platform}/${process.arch}`);

  if (!(await pathExists(join(workspaceDir, configPath)))) {
    output.error(`Config: missing ${configPath}. Run docstube wizard first.`);
    return { exitCode: 1 };
  }

  const validate = await runValidateCommand({ configPath, workspaceDir }, output);
  return { exitCode: validate.exitCode };
};
