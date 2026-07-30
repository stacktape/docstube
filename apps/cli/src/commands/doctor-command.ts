import type { CiPreflightReport } from '@docstube/contracts';
import type { CliCommandResult, CliOutput } from '../cli-output.ts';
import { renderCiPreflightReport, runCiPreflight } from './ci-preflight.ts';
import type { GitHubPreflightProbe } from './ci-preflight.ts';

// `doctor` is one report renderer over one check runner (ci-preflight.ts). `--ci` adds the GitHub
// half and the honest automation label; `--json` emits the versioned report the GitHub Action
// parses to abort BEFORE any model spend (quality-ci-reader-v2 decision 14).

export type DoctorCommandInput = {
  workspaceDir: string;
  ci?: boolean | undefined;
  json?: boolean | undefined;
  // Test seams — production passes none of these.
  env?: NodeJS.ProcessEnv | undefined;
  probeBinary?: ((binary: string) => Promise<boolean>) | undefined;
  github?: GitHubPreflightProbe | undefined;
  now?: (() => Date) | undefined;
};

export const runDoctorCommand = async (input: DoctorCommandInput, output: CliOutput): Promise<CliCommandResult> => {
  const report: CiPreflightReport = await runCiPreflight({
    workspaceDir: input.workspaceDir,
    mode: input.ci === true ? 'ci' : 'local',
    ...(input.env === undefined ? {} : { env: input.env }),
    ...(input.probeBinary === undefined ? {} : { probeBinary: input.probeBinary }),
    ...(input.github === undefined ? {} : { github: input.github }),
    ...(input.now === undefined ? {} : { now: input.now })
  });

  if (input.json === true) {
    // JSON only on stdout: the Action parses this stream, so nothing else may be written to it.
    output.info(JSON.stringify(report, null, 2));
  } else {
    for (const line of renderCiPreflightReport(report)) {
      output.info(line);
    }
  }

  return { exitCode: report.ok ? 0 : 1 };
};
