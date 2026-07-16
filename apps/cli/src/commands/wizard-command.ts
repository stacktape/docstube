import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { startLocalServer } from '@docstube/core';
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

export const runWizardCommand = async (input: WizardCommandInput, output: CliOutput): Promise<CliCommandResult> => {
  const uiDistDir = input.uiDevServerUrl === undefined ? await stagedUiDir() : undefined;
  if (input.uiDevServerUrl === undefined && uiDistDir === undefined) {
    output.error(
      'no built local UI found next to the CLI and no dev server configured — reinstall docstube or run via `pnpm dev wizard`'
    );
    return { exitCode: 1 };
  }
  const server = await startLocalServer({
    repoRoot: input.workspaceDir,
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
