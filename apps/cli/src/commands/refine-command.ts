import {
  CoreError,
  createManifestStore,
  createTaskRunnerFromConfig,
  loadConfigFamily,
  runRefine
} from '@docstube/core';
import { emitCurrentSite } from './emit-current-site.ts';
import type { CliCommandResult, CliOutput } from '../cli-output.ts';
import { countRunFailureModes } from '../runtime-telemetry.ts';
import { reportRunSpend } from './run-spend.ts';

export type RefineCommandInput = {
  workspaceDir: string;
  target?: string | undefined;
  failedOnly?: boolean | undefined;
  maxPages?: number | undefined;
  maxRoundsPerPage?: number | undefined;
  totalRounds?: number | undefined;
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
      maxPages: input.maxPages,
      maxRoundsPerPage: input.maxRoundsPerPage,
      totalRounds: input.totalRounds
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
    reportRunSpend(output, summary);
    output.info(`run ${summary.runId}: ${summary.outcome}`);
    // RefineSummary carries no findings or flag kinds (owned by another workstream); only the
    // budget freeze is observable here.
    return {
      exitCode: 0,
      failureModes: countRunFailureModes({ frozen: summary.outcome === 'frozen' })
    };
  } catch (error) {
    if (error instanceof CoreError) {
      output.error(error.message);
      return { exitCode: 1 };
    }
    throw error;
  }
};
