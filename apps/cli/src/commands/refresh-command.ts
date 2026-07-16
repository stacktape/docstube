import {
  CoreError,
  createManifestStore,
  createTaskRunnerFromConfig,
  loadConfigFamily,
  runRefresh
} from '@docstube/core';
import { emitCurrentSite } from './emit-current-site.ts';
import type { CliCommandResult, CliOutput } from '../cli-output.ts';

export type RefreshCommandInput = {
  workspaceDir: string;
  maxAttempts?: number | undefined;
};

export const runRefreshCommand = async (input: RefreshCommandInput, output: CliOutput): Promise<CliCommandResult> => {
  try {
    const family = await loadConfigFamily(input.workspaceDir);
    const runner = createTaskRunnerFromConfig(family.config, input.workspaceDir);
    output.info(`refreshing with ${runner.transportId} (${runner.model})…`);

    const summary = await runRefresh({
      repoRoot: input.workspaceDir,
      runTask: runner.runTask,
      toolDescriptors: runner.toolDescriptors,
      maxAttemptsPerPage: input.maxAttempts
    });
    for (const slug of summary.regenerated) {
      output.info(`  regen  ${slug}`);
    }
    output.info(`  ${summary.unchangedCount} page(s) unchanged`);
    for (const warning of summary.warnings) {
      output.info(`  warn  ${warning}`);
    }

    // Re-emit the self-contained site from the updated manifest.
    const store = createManifestStore(input.workspaceDir, family.config.versions.current);
    await emitCurrentSite({ workspaceDir: input.workspaceDir, family, store });
    output.info(`site emitted to ${family.config.outDir}/ — build it with: npm install && npm run build`);

    if (summary.outcome === 'flagged') {
      output.info('refresh finished with open flags — review them with `docstube status`');
    }
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
