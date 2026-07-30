import { CoreError, createTaskRunnerFromConfig, loadConfigFamily, runRefine, withRunLock } from '@docstube/core';
import type { RefineSummary, TaskRunner } from '@docstube/core';
import type { ToolDescriptor } from '@docstube/contracts';
import { emitPersistedSite } from './emit-current-site.ts';
import type { CliCommandResult, CliOutput } from '../cli-output.ts';
import { countRunFailureModes } from '../runtime-telemetry.ts';
import { reportRunSpend } from './run-spend.ts';
import { reportRunnerRouting } from './runner-banner.ts';

export type RefineCommandInput = {
  workspaceDir: string;
  target?: string | undefined;
  failedOnly?: boolean | undefined;
  maxPages?: number | undefined;
  maxRoundsPerPage?: number | undefined;
  totalRounds?: number | undefined;
  // Tests: a scripted task runner instead of the configured transport (CI never calls live agents).
  taskRunner?: { runTask: TaskRunner; toolDescriptors: ToolDescriptor[] } | undefined;
};

export const runRefineCommand = async (input: RefineCommandInput, output: CliOutput): Promise<CliCommandResult> => {
  try {
    const family = await loadConfigFamily(input.workspaceDir);
    const configuredRunner =
      input.taskRunner === undefined ? createTaskRunnerFromConfig(family.config, input.workspaceDir) : undefined;
    if (configuredRunner !== undefined) {
      reportRunnerRouting(output, 'refining', configuredRunner);
    }
    const runner = input.taskRunner ?? configuredRunner;
    if (runner === undefined) {
      throw new CoreError('pipeline-failed', 'no task runner available');
    }

    let summary: RefineSummary;
    try {
      // ONE RUN AT A TIME PER WORKSPACE (run-lock.ts): refine rewrites the same committed shards a
      // concurrent generate is publishing into, so it takes the same lock generate does.
      summary = await withRunLock({ repoRoot: input.workspaceDir, mode: 'refine' }, (handle) =>
        runRefine({
          repoRoot: input.workspaceDir,
          runTask: runner.runTask,
          toolDescriptors: runner.toolDescriptors,
          runId: handle.runId,
          target: input.target,
          failedOnly: input.failedOnly,
          maxPages: input.maxPages,
          maxRoundsPerPage: input.maxRoundsPerPage,
          totalRounds: input.totalRounds
        })
      );
    } catch (runError) {
      // A refused start attempted nothing, so there is no partial state to re-emit from.
      if (runError instanceof CoreError && runError.code === 'run-in-progress') {
        throw runError;
      }
      // EMISSION AFTER PARTIAL FAILURE (wave 2b close final): refine persists page by page, so a
      // later page throwing leaves EARLIER pages committed with fresh shards while the rendered
      // routes still show the pre-refine state — current shards disagreeing with stale routes.
      // Same finally-shaped emission as generate: emission consumes only committed state, so what
      // it emits is consistent; it no-ops when no manifest was ever persisted. The run error is
      // surfaced AFTER emission, and an emission failure must never mask it.
      try {
        const emitted = await emitPersistedSite(input.workspaceDir, family, output);
        if (emitted.emitted) {
          output.info(`run failed — site re-emitted to ${family.config.outDir}/ from the persisted state`);
        }
      } catch (emitError) {
        output.error(`site emission after the failed run also failed: ${(emitError as Error).message}`);
      }
      throw runError;
    }

    if (summary.refined.length === 0) {
      output.info(`nothing to refine (${summary.consideredCount} page(s) considered)`);
      return { exitCode: 0 };
    }
    for (const page of summary.refined) {
      output.info(
        `  ${page.status === 'passed' ? 'ok  ' : 'FLAG'}  ${page.slug} — checked claims ${page.checkedClaimsBefore} → ${page.checkedClaimsAfter} (${page.attempts} attempt(s))`
      );
    }

    await emitPersistedSite(input.workspaceDir, family, output);
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
