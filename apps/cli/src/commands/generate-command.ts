import {
  CoreError,
  createTaskRunnerFromConfig,
  emitPublicationDecision,
  failedPublicationInputs,
  loadConfigFamily,
  resolveCommit,
  runGenerate,
  withRunLock
} from '@docstube/core';
import type { GenerateSummary, TaskRunner } from '@docstube/core';
import type { ToolDescriptor } from '@docstube/contracts';
import { createSitePublisher } from './emit-current-site.ts';
import type { CliCommandResult, CliOutput } from '../cli-output.ts';
import { countRunFailureModes } from '../runtime-telemetry.ts';
import { reportRunSpend } from './run-spend.ts';
import { reportRunnerRouting } from './runner-banner.ts';

export type GenerateCommandInput = {
  workspaceDir: string;
  maxAttempts?: number | undefined;
  // `--ci`: emit the fail-closed PublicationDecision + output inventory the GitHub Action enforces
  // (PRODUCT §3.3). Off by default — a local run has no merge to gate.
  ci?: boolean | undefined;
  // Tests: a scripted task runner instead of the configured transport (CI never calls live agents).
  taskRunner?: { runTask: TaskRunner; toolDescriptors: ToolDescriptor[] } | undefined;
};

export const runGenerateCommand = async (input: GenerateCommandInput, output: CliOutput): Promise<CliCommandResult> => {
  try {
    const family = await loadConfigFamily(input.workspaceDir);
    const configuredRunner =
      input.taskRunner === undefined ? createTaskRunnerFromConfig(family.config, input.workspaceDir) : undefined;
    if (configuredRunner !== undefined) {
      reportRunnerRouting(output, 'generating', configuredRunner);
    }
    const runner = input.taskRunner ?? configuredRunner;
    if (runner === undefined) {
      throw new CoreError('pipeline-failed', 'no task runner available');
    }

    let summary: GenerateSummary;
    try {
      // ONE RUN AT A TIME PER WORKSPACE (run-lock.ts). A CLI generate started while the local UI
      // has a run going would share `.docstube/staging/` with it — the single mutable area
      // staged-atomic publish depends on owning — so it refuses instead, naming the run in flight.
      // A lock left behind by a process that died is taken over here, not waited on: the crashed
      // run's interrupted publish is repaired forward by THIS run (publish-staging.ts §finish-forward).
      summary = await withRunLock({ repoRoot: input.workspaceDir, mode: 'generate' }, (handle) =>
        runGenerate({
          repoRoot: input.workspaceDir,
          runTask: runner.runTask,
          toolDescriptors: runner.toolDescriptors,
          runId: handle.runId,
          maxAttemptsPerPage: input.maxAttempts,
          ci: input.ci,
          publishSite: createSitePublisher(input.workspaceDir, family, output)
        })
      );
    } catch (runError) {
      // A REFUSED START IS NOT A FAILED RUN. Nothing was attempted, so there is nothing to report
      // as unpublished and no decision to record — the outer handler prints the typed message
      // (which names the run already in flight) and exits non-zero.
      if (runError instanceof CoreError && runError.code === 'run-in-progress') {
        throw runError;
      }
      // NOTHING TO RECONCILE AFTER A CRASH (pipeline-v2 decision 3): a run publishes in ONE step
      // after the whole plan completes, so a run that threw published nothing — the site, the
      // manifest, and the routes are exactly as the last successful publish left them. The old
      // re-emit-from-persisted-state path existed because pages used to land one at a time; under
      // staged publish it would be a second, competing publish path over state nothing changed.
      output.info('run failed — nothing was published; the site and manifest are unchanged');
      // A CRASHED RUN STILL OWES CI A DECISION: without one the Action cannot distinguish a run
      // that died from a CLI that never emits decisions, and both fail closed — but only the
      // recorded decision puts `execution: failed` on the PR instead of a silent withheld merge.
      if (input.ci === true) {
        try {
          await emitPublicationDecision({
            repoRoot: input.workspaceDir,
            outDir: family.config.outDir,
            inputs: failedPublicationInputs({ commit: await resolveCommit(input.workspaceDir) })
          });
        } catch (decisionError) {
          output.error(
            `could not record the publication decision for the failed run: ${(decisionError as Error).message}`
          );
        }
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

    // Assembly already happened INSIDE the publish step (staged-atomic publish): routes, twins,
    // shards and the manifest index landed together, or none of them did.
    if (summary.published) {
      output.info(`site published to ${family.config.outDir}/ — build it with: npm install && npm run build`);
    } else {
      output.info('nothing was published this run — the site and manifest are exactly as they were');
    }

    // The decision is minted AFTER emission: the output inventory it binds to must describe the
    // tree the Action is about to stage, site files included.
    if (input.ci === true) {
      if (summary.publicationInputs === undefined) {
        output.error('run finished without publication inputs — refusing to emit a decision that proves nothing');
        return { exitCode: 1 };
      }
      const { decision } = await emitPublicationDecision({
        repoRoot: input.workspaceDir,
        outDir: family.config.outDir,
        inputs: summary.publicationInputs
      });
      output.info(
        `publication decision: ${decision.execution} · ${decision.plan.completed}/${decision.plan.planned} page(s) · ` +
          `gate ${decision.deterministicGate} · publishable ${decision.publishable} · auto-merge ${decision.autoMergeEligible}` +
          (decision.reasonCodes.length > 0 ? ` (${decision.reasonCodes.join(', ')})` : '')
      );
    }

    if (summary.outcome === 'flagged') {
      output.info('run finished with open flags — review them with `docstube status`');
    }
    if (summary.outcome === 'frozen') {
      output.info(
        'run FROZE at the configured budget cap (agents.budgets.maxRunUsd) — NOTHING was published, so the site ' +
          'never shows a half-applied change. Finished pages are staged under .docstube/staging/; rerun `docstube ' +
          'generate` to finish the plan and publish it all at once (staged pages are not re-billed)'
      );
    }
    if (summary.resumedPages > 0) {
      output.info(`  resumed ${summary.resumedPages} page(s) from staged work — not regenerated, not re-billed`);
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
