import {
  CoreError,
  createManifestStore,
  createTaskRunnerFromConfig,
  loadConfigFamily,
  runGenerate
} from '@docstube/core';
import type { ConfigFamily, GenerateSummary, TaskRunner } from '@docstube/core';
import type { ToolDescriptor } from '@docstube/contracts';
import { emitCurrentSite } from './emit-current-site.ts';
import type { EmitCurrentSiteResult } from './emit-current-site.ts';
import type { CliCommandResult, CliOutput } from '../cli-output.ts';
import { countRunFailureModes } from '../runtime-telemetry.ts';
import { reportRunSpend } from './run-spend.ts';

export type GenerateCommandInput = {
  workspaceDir: string;
  maxAttempts?: number | undefined;
  // Tests: a scripted task runner instead of the configured transport (CI never calls live agents).
  taskRunner?: { runTask: TaskRunner; toolDescriptors: ToolDescriptor[] } | undefined;
};

// The shared assemble step, with its reporting: reused by the success path AND the
// partial-failure path so both emit the same way.
const emitPersistedSite = async (
  workspaceDir: string,
  family: ConfigFamily,
  output: CliOutput
): Promise<EmitCurrentSiteResult> => {
  const store = createManifestStore(workspaceDir, family.config.versions.current);
  const result = await emitCurrentSite({ workspaceDir, family, store });
  for (const conflict of result.themeConflicts) {
    output.info(`  theme-conflict  ${conflict}`);
  }
  // Binding failures / ignored stale locale files: the named pages rendered UNVERIFIED or as
  // source fallbacks instead of stale state.
  for (const warning of result.warnings) {
    output.error(`  unverified  ${warning}`);
  }
  return result;
};

export const runGenerateCommand = async (input: GenerateCommandInput, output: CliOutput): Promise<CliCommandResult> => {
  try {
    const family = await loadConfigFamily(input.workspaceDir);
    const configuredRunner =
      input.taskRunner === undefined ? createTaskRunnerFromConfig(family.config, input.workspaceDir) : undefined;
    if (configuredRunner !== undefined) {
      output.info(`generating with ${configuredRunner.transportId} (${configuredRunner.model})…`);
    }
    const runner = input.taskRunner ?? configuredRunner;
    if (runner === undefined) {
      throw new CoreError('pipeline-failed', 'no task runner available');
    }

    let summary: GenerateSummary;
    try {
      summary = await runGenerate({
        repoRoot: input.workspaceDir,
        runTask: runner.runTask,
        toolDescriptors: runner.toolDescriptors,
        maxAttemptsPerPage: input.maxAttempts
      });
    } catch (runError) {
      // EMISSION AFTER PARTIAL FAILURE (wave 2b close): the pipeline can throw AFTER pages were
      // persisted (translation/transport errors) — the rendered routes must still be reconciled
      // with the persisted shards, or an old route keeps rendering against a new shard. Emission
      // consumes only committed state, so what it emits is consistent; it no-ops when no manifest
      // was ever persisted. The run error is surfaced AFTER emission, and an emission failure
      // must never mask it.
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
    for (const page of summary.pages) {
      output.info(`  ${page.status === 'passed' ? 'ok  ' : 'FLAG'}  ${page.slug} (${page.attempts} attempt(s))`);
    }
    for (const translation of summary.translations) {
      output.info(
        `  ${translation.status === 'passed' ? 'ok  ' : 'FLAG'}  ${translation.slug} [${translation.locale}]`
      );
    }
    for (const warning of summary.warnings) {
      output.info(`  warn  ${warning}`);
    }

    // Assemble the self-contained site from what the pipeline shipped.
    const emitResult = await emitPersistedSite(input.workspaceDir, family, output);
    if (!emitResult.emitted) {
      output.error('pipeline finished but wrote no manifest — this is a bug');
      return { exitCode: 1 };
    }
    output.info(`site emitted to ${family.config.outDir}/ — build it with: npm install && npm run build`);

    if (summary.outcome === 'flagged') {
      output.info('run finished with open flags — review them with `docstube status`');
    }
    if (summary.outcome === 'frozen') {
      output.info(
        'run FROZE at the configured budget cap (agents.budgets.maxRunUsd) — rerun to continue; finished pages are cached'
      );
    }
    reportRunSpend(output, summary);
    output.info(`run ${summary.runId}: ${summary.outcome}`);
    return {
      exitCode: summary.outcome === 'failed' ? 1 : 0,
      failureModes: countRunFailureModes({
        findingChecks: [
          ...summary.pages.flatMap((page) => page.findings.map((finding) => finding.check)),
          ...summary.siteFindings.map((finding) => finding.check)
        ],
        openFlagKinds: summary.openFlagKinds,
        frozen: summary.outcome === 'frozen'
      })
    };
  } catch (error) {
    if (error instanceof CoreError) {
      output.error(error.message);
      return { exitCode: 1 };
    }
    throw error;
  }
};
