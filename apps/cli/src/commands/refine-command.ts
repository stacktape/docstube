import { join } from 'node:path';
import { defaultOutput } from '../cli-output.ts';
import type { CliCommandResult, CliOutput } from '../cli-output.ts';
import { manifestPath, pathExists } from '../workspace-paths.ts';

export type RefineCommandOptions = {
  configPath?: string;
  failed?: boolean;
  maxRounds?: number;
  refine?: (input: {
    configPath?: string;
    failedOnly?: boolean;
    maxRounds?: number;
    target?: string;
    workspaceDir: string;
  }) => Promise<{
    candidates: readonly unknown[];
    manifest: { pages: readonly unknown[] };
    plannedPages: readonly unknown[];
    refinedPages: readonly { id: string; path: string; status: string }[];
  }>;
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

  const refine = options.refine ?? (await import('@docstube/core')).refineProjectDocumentation;
  const result = await refine({
    configPath,
    failedOnly: options.failed,
    maxRounds: options.maxRounds,
    target: options.target,
    workspaceDir
  });
  output.info(`Loaded manifest with ${result.manifest.pages.length} pages.`);
  output.info(`Ranked ${result.candidates.length} refinement candidates.`);

  if (result.plannedPages.length === 0) {
    output.info('No pages require refinement.');
    return { exitCode: 0 };
  }

  for (const page of result.refinedPages) {
    output.info(`refined: ${page.id} status=${page.status} path=${page.path}`);
  }
  return { exitCode: 0 };
};
