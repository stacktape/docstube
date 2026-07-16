import {
  CoreError,
  createManifestStore,
  createTaskRunnerFromConfig,
  loadConfigFamily,
  runRefine
} from '@docstube/core';
import { emitCurrentSite } from './emit-current-site.ts';
import type { CliCommandResult, CliOutput } from '../cli-output.ts';

export type RefineCommandInput = {
  workspaceDir: string;
  target?: string | undefined;
  failedOnly?: boolean | undefined;
  maxRounds?: number | undefined;
};

export const runRefineCommand = async (input: RefineCommandInput, output: CliOutput): Promise<CliCommandResult> => {
  try {
    const family = await loadConfigFamily(input.workspaceDir);
    const runner = createTaskRunnerFromConfig(family.config, input.workspaceDir);
    output.info(`refining with ${runner.transportId} (${runner.model})…`);

    const summary = await runRefine({
      repoRoot: input.workspaceDir,
      runTask: runner.runTask,
      toolDescriptors: runner.toolDescriptors,
      target: input.target,
      failedOnly: input.failedOnly,
      maxRounds: input.maxRounds
    });
    if (summary.refined.length === 0) {
      output.info(`nothing to refine (${summary.consideredCount} page(s) considered)`);
      return { exitCode: 0 };
    }
    for (const page of summary.refined) {
      output.info(
        `  ${page.status === 'passed' ? 'ok  ' : 'FLAG'}  ${page.slug} — proven blocks ${page.provenBlocksBefore} → ${page.provenBlocksAfter} (${page.attempts} attempt(s))`
      );
    }

    const store = createManifestStore(input.workspaceDir, family.config.versions.current);
    await emitCurrentSite({ workspaceDir: input.workspaceDir, family, store });
    output.info(`run ${summary.runId}: ${summary.outcome}`);
    return { exitCode: 0 };
  } catch (error) {
    if (error instanceof CoreError) {
      output.error(error.message);
      return { exitCode: 1 };
    }
    throw error;
  }
};
