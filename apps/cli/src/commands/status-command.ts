import { defaultOutput } from '../cli-output.ts';
import type { CliCommandResult, CliOutput } from '../cli-output.ts';

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
  const { getProjectStatus } = await import('@docstube/core');
  const status = await getProjectStatus({ configPath, workspaceDir });

  output.info(
    `Config: ${status.config.found ? (status.config.valid ? 'valid' : 'invalid') : 'missing'} (${configPath})`
  );
  if (status.config.error) {
    output.error(status.config.error);
  }

  if (!status.manifest) {
    output.info('Manifest: missing');
  } else {
    const summary =
      Object.keys(status.manifest.statusCounts).length === 0
        ? '0 pages'
        : Object.entries(status.manifest.statusCounts)
            .map(([pageStatus, count]) => `${pageStatus}:${count}`)
            .join(', ');
    output.info(`Manifest: found (${status.manifest.generatedWith})`);
    output.info(`Pages: ${summary}`);
  }

  output.info(`State: ${status.pageState.found ? `${status.pageState.pageCount} pages` : 'missing'}`);
  output.info(`Source files considered: ${status.sourceFilesCount}`);
  output.info(`Stale pages: ${status.staleDecisions.length}`);
  output.info(
    `Refinement candidates: ${status.refinementCandidates.filter((candidate) => candidate.score < 100).length}`
  );
  return { exitCode: 0 };
};
