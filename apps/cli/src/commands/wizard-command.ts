import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { standardToolDescriptors } from '@docstube/agent-runtime';
import { buildCodemap } from '@docstube/codemap';
import {
  createManifestStore,
  createPluginHost,
  createTaskRunnerFromConfig,
  loadConfigFamily,
  loadConfiguredPlugins,
  registerBuiltinPlugins,
  resolveCommit,
  runGenerate,
  runRefine,
  startLocalServer
} from '@docstube/core';
import type { ControlPlaneInjection } from '@docstube/core';
import type { AgentTaskSpec, ToolDescriptor, Transcript } from '@docstube/contracts';
import { idPrefixes, mintId } from '@docstube/contracts';
import { emitCurrentSite } from './emit-current-site.ts';
import type { CliCommandResult, CliOutput } from '../cli-output.ts';
import { pathExists } from '../workspace-paths.ts';

// `docstube wizard` serves the local control plane (dashboard + flag queue now; the full setup
// wizard UI lands next wave). In dev, scripts/dev.ts runs Vite and passes its URL via
// DOCSTUBE_UI_DEV_SERVER_URL; in production the built UI is staged next to the CLI dist.

export type WizardCommandInput = {
  workspaceDir: string;
  uiDevServerUrl?: string | undefined;
  port?: number | undefined;
  // Tests: return immediately instead of waiting for SIGINT.
  waitForShutdown?: boolean | undefined;
};

const stagedUiDir = async (): Promise<string | undefined> => {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [join(here, '..', '..', 'local-ui'), join(here, '..', 'local-ui')]) {
    if (await pathExists(join(candidate, 'index.html'))) {
      return candidate;
    }
  }
  return undefined;
};

// The wizard's background run must end with the SAME assemble step the CLI generate/refine
// commands run (emit-current-site.ts): updating content and shards without re-emitting routes
// would leave rendered counts stale against the shard. Warnings surface the same way the CLI
// commands surface them.
export const emitWizardSite = async (workspaceDir: string, output: CliOutput): Promise<void> => {
  const family = await loadConfigFamily(workspaceDir);
  const store = createManifestStore(workspaceDir, family.config.versions.current);
  const result = await emitCurrentSite({ workspaceDir, family, store });
  for (const conflict of result.themeConflicts) {
    output.info(`  theme-conflict  ${conflict}`);
  }
  // MDX↔shard binding failures: the named pages rendered UNVERIFIED instead of stale trust state.
  for (const warning of result.warnings) {
    output.error(`  unverified  ${warning}`);
  }
};

export type WizardControlPlaneInput = {
  workspaceDir: string;
  // Tests: a scripted task runner instead of the configured transport (CI never calls live agents).
  taskRunner?: { runTask: (spec: AgentTaskSpec) => Promise<Transcript>; toolDescriptors: ToolDescriptor[] } | undefined;
};

// Exported for the wizard spec: the control-plane wiring IS the behavior under test (launchRun →
// pipeline → site emission), independent of the HTTP server around it.
export const createWizardControlPlane = (input: WizardControlPlaneInput, output: CliOutput): ControlPlaneInjection => {
  // Agent-backed mutations resolve config lazily: the wizard can start pre-scaffold and the
  // runner only materializes when the UI first needs it.
  const lazyRunner = async () => {
    if (input.taskRunner !== undefined) {
      return input.taskRunner;
    }
    const family = await loadConfigFamily(input.workspaceDir);
    return createTaskRunnerFromConfig(family.config, input.workspaceDir);
  };
  return {
    runTask: async (spec) => (await lazyRunner()).runTask(spec),
    toolDescriptors: standardToolDescriptors(),
    codemapProvider: async () => {
      const family = await loadConfigFamily(input.workspaceDir);
      const host = createPluginHost();
      await registerBuiltinPlugins(host);
      await loadConfiguredPlugins(host, family.config, input.workspaceDir);
      return buildCodemap({
        repoRoot: input.workspaceDir,
        commit: await resolveCommit(input.workspaceDir),
        packs: host.languagePacks().map((entry) => entry.definition)
      });
    },
    launchRun: async (mode) => {
      const runner = await lazyRunner();
      const runId = mintId(idPrefixes.run);
      const common = {
        repoRoot: input.workspaceDir,
        runTask: runner.runTask,
        toolDescriptors: runner.toolDescriptors,
        runId
      };
      // `refresh` is gone (pipeline-v2 decision 1): generate IS the reconciler.
      const run = mode === 'generate' ? runGenerate(common) : runRefine(common);
      // Fire-and-forget: the dashboard follows the journal; failures land there as run events.
      // A completed run re-emits the site so rendered routes never drift from the shards.
      void run
        .then(() => emitWizardSite(input.workspaceDir, output))
        .catch((error: unknown) => output.error(`background ${mode} run failed: ${(error as Error).message}`));
      return { runId };
    }
  };
};

export const runWizardCommand = async (input: WizardCommandInput, output: CliOutput): Promise<CliCommandResult> => {
  const uiDistDir = input.uiDevServerUrl === undefined ? await stagedUiDir() : undefined;
  if (input.uiDevServerUrl === undefined && uiDistDir === undefined) {
    output.error(
      'no built local UI found next to the CLI and no dev server configured — reinstall docstube or run via `pnpm dev wizard`'
    );
    return { exitCode: 1 };
  }
  const controlPlane = createWizardControlPlane({ workspaceDir: input.workspaceDir }, output);

  const server = await startLocalServer({
    repoRoot: input.workspaceDir,
    controlPlane,
    ...(input.port === undefined ? {} : { port: input.port }),
    ...(uiDistDir === undefined ? {} : { uiDistDir }),
    ...(input.uiDevServerUrl === undefined ? {} : { uiDevServerUrl: input.uiDevServerUrl })
  });
  output.info(`docstube control plane running at:\n\n  ${server.url}\n`);
  output.info('Press Ctrl+C to stop.');

  if (input.waitForShutdown === false) {
    await server.close();
    return { exitCode: 0 };
  }
  await new Promise<void>((resolve) => {
    const shutdown = () => {
      void server.close().then(resolve);
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
  return { exitCode: 0 };
};
