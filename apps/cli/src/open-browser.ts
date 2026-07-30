import { spawn } from 'node:child_process';

// Bare `docstube` opens the browser (PRODUCT §3.9.1) — but only when there is a human at a
// terminal to see it. A non-interactive shell (CI, a pipe, a container) gets the URL printed and
// nothing launched, and `--no-open` always wins.

export type OpenBrowserDecision = { open: boolean; reason: string };

export type ShouldOpenInput = {
  // --no-open / --open from the command line; undefined means "decide from the environment".
  requested?: boolean | undefined;
  isTty?: boolean | undefined;
  env?: NodeJS.ProcessEnv | undefined;
};

export const shouldOpenBrowser = (input: ShouldOpenInput = {}): OpenBrowserDecision => {
  const env = input.env ?? process.env;
  if (input.requested === false) {
    return { open: false, reason: '--no-open' };
  }
  if (env.DOCSTUBE_NO_OPEN === '1' || env.DOCSTUBE_NO_OPEN === 'true') {
    return { open: false, reason: 'DOCSTUBE_NO_OPEN is set' };
  }
  if (input.requested === true) {
    return { open: true, reason: '--open' };
  }
  if (env.CI !== undefined && env.CI !== '' && env.CI !== 'false') {
    return { open: false, reason: 'running in CI' };
  }
  if (input.isTty !== true) {
    return { open: false, reason: 'not an interactive terminal' };
  }
  return { open: true, reason: 'interactive terminal' };
};

const openCommand = (url: string): { command: string; args: string[] } => {
  if (process.platform === 'win32') {
    // `start` is a cmd builtin; the empty string is the window title `start` would otherwise eat.
    return { command: 'cmd', args: ['/c', 'start', '', url] };
  }
  if (process.platform === 'darwin') {
    return { command: 'open', args: [url] };
  }
  return { command: 'xdg-open', args: [url] };
};

// Best-effort and never fatal: a failed launch just means the user clicks the printed URL.
export const openBrowser = async (url: string): Promise<boolean> => {
  const { command, args } = openCommand(url);
  return new Promise<boolean>((resolve) => {
    try {
      const child = spawn(command, args, { stdio: 'ignore', detached: true });
      child.once('error', () => resolve(false));
      child.once('spawn', () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
};
