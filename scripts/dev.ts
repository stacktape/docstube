import { spawn } from 'node:child_process';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { execPath } from 'node:process';
import { fileURLToPath } from 'node:url';

type ChildExit = {
  code: number | null;
  signal: NodeJS.Signals | null;
};

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const cliSourceEntry = fileURLToPath(new URL('../apps/cli/src/cli.ts', import.meta.url));

const parsePort = (): number => {
  const raw = process.env.DOCSTUBE_UI_DEV_PORT ?? '5173';
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`DOCSTUBE_UI_DEV_PORT must be a TCP port number, received ${raw}.`);
  }

  return port;
};

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
};

const waitForExit = async (child: ChildProcess): Promise<ChildExit> =>
  new Promise((resolveExit) => {
    child.once('exit', (code, signal) => {
      resolveExit({ code, signal });
    });
  });

const waitForHttpReady = async (input: { child: ChildProcess; timeoutMs: number; url: string }): Promise<void> => {
  const deadline = Date.now() + input.timeoutMs;
  let lastError: unknown;

  const poll = async (): Promise<void> => {
    if (Date.now() >= deadline) {
      const detail = lastError instanceof Error ? ` Last error: ${lastError.message}` : '';
      throw new Error(`Timed out waiting for local UI dev server at ${input.url}.${detail}`);
    }

    if (input.child.exitCode !== null || input.child.signalCode !== null) {
      throw new Error(`Local UI dev server exited before becoming ready.`);
    }

    try {
      const response = await fetch(input.url);
      if (response.status < 500) {
        return;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await sleep(250);
    await poll();
  };

  await poll();
};

const stopChild = async (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  const exited = waitForExit(child);
  child.kill();
  await Promise.race([exited, sleep(3_000)]);

  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await Promise.race([exited, sleep(1_000)]);
  }
};

const forwardOutput = (child: ChildProcess): void => {
  child.stdout?.on('data', (chunk) => {
    process.stdout.write(chunk);
  });
  child.stderr?.on('data', (chunk) => {
    process.stderr.write(chunk);
  });
};

const spawnPnpm = (args: string[], options: SpawnOptions): ChildProcess => {
  if (process.platform === 'win32') {
    return spawn('cmd.exe', ['/d', '/c', ['pnpm', ...args].join(' ')], options);
  }

  return spawn('pnpm', args, options);
};

const runSourceCli = async (input: {
  args: string[];
  uiDevServerUrl?: string;
  viteProcess?: ChildProcess;
}): Promise<ChildExit> => {
  const child = spawn(execPath, ['--conditions=docstube-source', cliSourceEntry, ...input.args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...(input.uiDevServerUrl ? { DOCSTUBE_UI_DEV_SERVER_URL: input.uiDevServerUrl } : {})
    },
    stdio: 'inherit',
    windowsHide: true
  });

  const cleanup = async (): Promise<void> => {
    await stopChild(child);
    if (input.viteProcess) {
      await stopChild(input.viteProcess);
    }
  };

  process.once('SIGINT', () => {
    cleanup()
      .then(() => process.exit(130))
      .catch(() => process.exit(1));
  });
  process.once('SIGTERM', () => {
    cleanup()
      .then(() => process.exit(143))
      .catch(() => process.exit(1));
  });

  return waitForExit(child);
};

const readRunArgs = (): string[] => {
  const rawArgs = process.argv.slice(2);
  const args = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs;
  return args.length === 0 ? ['wizard'] : args;
};

const main = async (): Promise<void> => {
  const args = readRunArgs();
  const command = args[0];

  if (command !== 'wizard') {
    const result = await runSourceCli({ args });
    process.exitCode = result.code ?? (result.signal === 'SIGINT' ? 130 : 1);
    return;
  }

  const port = parsePort();
  const uiDevServerUrl = `http://127.0.0.1:${port}`;
  console.info(`Starting local UI dev server at ${uiDevServerUrl}.`);

  const viteProcess = spawnPnpm(
    ['--filter', '@docstube/web-ui', 'dev', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        DOCSTUBE_LOCAL_UI_DEV: '1',
        DOCSTUBE_LOCAL_UI_HMR_PORT: String(port)
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    }
  );
  forwardOutput(viteProcess);

  try {
    await waitForHttpReady({ child: viteProcess, timeoutMs: 30_000, url: uiDevServerUrl });
    console.info('Running source CLI with the Vite local UI.');
    const result = await runSourceCli({ args, uiDevServerUrl, viteProcess });
    process.exitCode = result.code ?? (result.signal === 'SIGINT' ? 130 : 1);
  } finally {
    await stopChild(viteProcess);
  }
};

await main();
