import { defaultOutput } from '../cli-output.ts';
import type { CliCommandResult, CliOutput } from '../cli-output.ts';

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
  const { doctorProject } = await import('@docstube/core');
  const result = await doctorProject({ configPath, workspaceDir });
  for (const check of result.checks) {
    const line = `${check.id}: ${check.status} - ${check.message}`;
    if (check.status === 'failed') {
      output.error(line);
    } else {
      output.info(line);
    }
  }
  return { exitCode: result.ok ? 0 : 1 };
};
