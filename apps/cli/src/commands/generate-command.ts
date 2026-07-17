import {
  CoreError,
  createManifestStore,
  createTaskRunnerFromConfig,
  loadConfigFamily,
  runGenerate
} from '@docstube/core';
import { emitCurrentSite } from './emit-current-site.ts';
import type { CliCommandResult, CliOutput } from '../cli-output.ts';
import { countRunFailureModes } from '../runtime-telemetry.ts';
import { reportRunSpend } from './run-spend.ts';

export type GenerateCommandInput = {
  workspaceDir: string;
  maxAttempts?: number | undefined;
};

export const runGenerateCommand = async (input: GenerateCommandInput, output: CliOutput): Promise<CliCommandResult> => {
  try {
    const family = await loadConfigFamily(input.workspaceDir);
    const runner = createTaskRunnerFromConfig(family.config, input.workspaceDir);
    output.info(`generating with ${runner.transportId} (${runner.model})…`);

    const summary = await runGenerate({
      repoRoot: input.workspaceDir,
      runTask: runner.runTask,
      toolDescriptors: runner.toolDescriptors,
      maxAttemptsPerPage: input.maxAttempts
    });
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
    const store = createManifestStore(input.workspaceDir, family.config.versions.current);
    const emitResult = await emitCurrentSite({ workspaceDir: input.workspaceDir, family, store });
    if (!emitResult.emitted) {
      output.error('pipeline finished but wrote no manifest — this is a bug');
      return { exitCode: 1 };
    }
    for (const conflict of emitResult.themeConflicts) {
      output.info(`  theme-conflict  ${conflict}`);
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
