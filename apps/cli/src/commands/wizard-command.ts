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
  readSetupStatus,
  registerBuiltinPlugins,
  resolveCommit,
  resolveSetupConfig,
  runGenerate,
  runRefine,
  runTransportPreflight,
  startLocalServer
} from '@docstube/core';
import type { ControlPlaneInjection } from '@docstube/core';
import type { AgentTaskSpec, ManifestIndex, ToolDescriptor, Transcript } from '@docstube/contracts';
import { idPrefixes, mintId } from '@docstube/contracts';
import { emitCurrentSite } from './emit-current-site.ts';
import type { CliCommandResult, CliOutput } from '../cli-output.ts';
import { openBrowser, shouldOpenBrowser } from '../open-browser.ts';
import { pathExists } from '../workspace-paths.ts';

// `docstube wizard` (and bare `docstube`) serves the local control plane: first-run setup,
// generation dashboard, review UI, flag queue. In dev, scripts/dev.ts runs Vite and passes its URL
// via DOCSTUBE_UI_DEV_SERVER_URL; in production the built UI is staged next to the CLI dist.
//
// Everything agent-backed resolves its config through resolveSetupConfig, NOT loadConfigFamily:
// that is what lets the setup steps designed for first run actually work on first run, from the
// onboarding draft, before docstube.yml exists.

export type WizardCommandInput = {
  workspaceDir: string;
  uiDevServerUrl?: string | undefined;
  port?: number | undefined;
  // undefined = decide from the environment (TTY + CI); false = never open.
  open?: boolean | undefined;
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
export const emitWizardSite = async (
  workspaceDir: string,
  output: CliOutput,
  // Passed by generate's staged-atomic publish: the index the publish is about to commit (see
  // emit-current-site.ts). Omitted everywhere else — then the published index is rendered.
  index?: ManifestIndex
): Promise<void> => {
  const family = await loadConfigFamily(workspaceDir);
  const store = createManifestStore(workspaceDir, family.config.versions.current);
  const result = await emitCurrentSite({ workspaceDir, family, store, ...(index === undefined ? {} : { index }) });
  for (const conflict of result.themeConflicts) {
    output.info(`  theme-conflict  ${conflict}`);
  }
  // Same neutral emit-warning label the CLI commands print (emit-current-site.ts): these lines cover
  // dropped authored frontmatter and stale locale files as well as binding failures, so they must
  // not be labelled with the page trust state's name.
  for (const warning of result.warnings) {
    output.error(`  emit-warning  ${warning}`);
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
  // Agent-backed mutations resolve config lazily, and through resolveSetupConfig: during first-run
  // setup there IS no docstube.yml, so the transport comes from the onboarding draft's agent
  // settings. The runner only materializes when the UI first needs it.
  const lazyRunner = async () => {
    if (input.taskRunner !== undefined) {
      return input.taskRunner;
    }
    const { config } = await resolveSetupConfig(input.workspaceDir);
    return createTaskRunnerFromConfig(config, input.workspaceDir);
  };
  return {
    runTask: async (spec) => (await lazyRunner()).runTask(spec),
    toolDescriptors: standardToolDescriptors(),
    // An injected task runner means no live call is ever made — the preflight rides the same seam.
    preflight: (config) =>
      runTransportPreflight({
        repoRoot: input.workspaceDir,
        config,
        ...(input.taskRunner === undefined ? {} : { runTask: input.taskRunner.runTask })
      }),
    codemapProvider: async () => {
      const { config } = await resolveSetupConfig(input.workspaceDir);
      const host = createPluginHost();
      await registerBuiltinPlugins(host);
      await loadConfiguredPlugins(host, config, input.workspaceDir);
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
      // generate owns its own publish step (staged-atomic publish): routes are emitted INSIDE it,
      // together with shards and the index, so the wizard must not emit a second time — a frozen or
      // crashed generate publishes nothing, and a stray emission would be exactly the independent
      // publish path decision 3 removes. `refine` still writes pages directly, so it still emits.
      const run =
        mode === 'generate'
          ? runGenerate({
              ...common,
              publishSite: async ({ index }) => {
                await emitWizardSite(input.workspaceDir, output, index);
              }
            })
          : runRefine(common);
      // Fire-and-forget: the dashboard follows the journal; failures land there as run events.
      void (async () => {
        let runError: unknown;
        try {
          await run;
        } catch (error) {
          runError = error;
        }
        if (mode !== 'generate') {
          try {
            await emitWizardSite(input.workspaceDir, output);
          } catch (error) {
            output.error(`site emission after the ${mode} run failed: ${(error as Error).message}`);
          }
        }
        if (runError !== undefined) {
          output.error(`background ${mode} run failed: ${(runError as Error).message}`);
        }
      })();
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
  // Context-aware entry (PRODUCT §3.9.1): the surface the browser lands on is decided by whether a
  // config exists — the same decision `setup.status` hands the UI, so the two can never disagree.
  const status = await readSetupStatus(input.workspaceDir);
  output.info(
    status.initialSurface === 'setup'
      ? 'No docstube.yml here yet — opening first-run setup.'
      : 'docstube.yml found — opening the dashboard.'
  );
  output.info(`docstube control plane running at:\n\n  ${server.url}\n`);

  const decision = shouldOpenBrowser({
    ...(input.open === undefined ? {} : { requested: input.open }),
    isTty: process.stdout.isTTY === true
  });
  if (decision.open) {
    const opened = await openBrowser(server.url);
    if (!opened) {
      output.info('Could not launch a browser automatically — open the URL above.');
    }
  } else {
    output.info(`Not opening a browser (${decision.reason}) — open the URL above.`);
  }
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
