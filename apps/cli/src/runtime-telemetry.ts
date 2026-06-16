import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { telemetryPath } from './workspace-paths.ts';

const docstubeVersion = '0.0.2';

export type RuntimeTelemetryErrorKind = 'command-failed' | 'exception';

export type RuntimeTelemetryStatus = 'failed' | 'started' | 'succeeded';

export type RuntimeTelemetryEvent = {
  command: string;
  durationMs?: number;
  errorKind?: RuntimeTelemetryErrorKind;
  event: 'cli-command';
  surface: 'runtime';
  status: RuntimeTelemetryStatus;
  version: string;
};

export type RuntimeTelemetryTransport = (event: RuntimeTelemetryEvent) => Promise<void> | void;

export type RuntimeTelemetryCommandResult = {
  exitCode: number;
};

export type RuntimeTelemetryDisclosureResult = {
  disclosed: boolean;
};

const knownRuntimeTelemetryCommands = new Set([
  'check',
  'doctor',
  'generate',
  'help',
  'refresh',
  'refine',
  'status',
  'upgrade',
  'validate',
  'version',
  'wizard'
]);

const falseValues = new Set(['0', 'false', 'no', 'off']);
const trueValues = new Set(['1', 'true', 'yes', 'on']);

const normalizedCommandName = (command: string): string =>
  knownRuntimeTelemetryCommands.has(command) ? command : 'unknown';

const envBoolean = (value: string | undefined): boolean | undefined => {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (trueValues.has(normalized)) {
    return true;
  }
  if (falseValues.has(normalized)) {
    return false;
  }
  return undefined;
};

const envDisablesTelemetry = (env: NodeJS.ProcessEnv): boolean =>
  env.DO_NOT_TRACK === '1' ||
  envBoolean(env.DOCSTUBE_TELEMETRY) === false ||
  envBoolean(env.DOCSTUBE_TELEMETRY_DISABLED) === true;

const envHasTelemetryPreference = (env: NodeJS.ProcessEnv): boolean =>
  envBoolean(env.DOCSTUBE_TELEMETRY) !== undefined || envBoolean(env.DOCSTUBE_TELEMETRY_DISABLED) !== undefined;

const runtimeTelemetryDisclosureMessage =
  'docstube collects privacy-preserving runtime telemetry by default: command names, durations, coarse errors, and anonymous environment facts. It never sends source code, prompts, generated docs, paths, project names, repo contents, or secrets. Disable it with DOCSTUBE_TELEMETRY=false or DO_NOT_TRACK=1.';

export const createRuntimeTelemetryEvent = (input: {
  command: string;
  durationMs?: number;
  errorKind?: RuntimeTelemetryErrorKind;
  status: RuntimeTelemetryStatus;
}): RuntimeTelemetryEvent => ({
  event: 'cli-command',
  command: normalizedCommandName(input.command),
  durationMs: input.durationMs,
  errorKind: input.errorKind,
  status: input.status,
  version: docstubeVersion,
  surface: 'runtime'
});

export const readRuntimeTelemetryEnabled = async (
  workspaceDir = process.cwd(),
  env: NodeJS.ProcessEnv = process.env
): Promise<boolean> => {
  if (envDisablesTelemetry(env)) {
    return false;
  }

  try {
    const parsed = JSON.parse(await readFile(telemetryPath(workspaceDir), 'utf8')) as { enabled?: unknown };
    if (typeof parsed.enabled === 'boolean') {
      return parsed.enabled;
    }
  } catch {
    return envBoolean(env.DOCSTUBE_TELEMETRY) ?? true;
  }

  return envBoolean(env.DOCSTUBE_TELEMETRY) ?? true;
};

export const writeRuntimeTelemetryEnabled = async (workspaceDir: string, enabled: boolean): Promise<void> => {
  const path = telemetryPath(workspaceDir);
  await mkdir(join(workspaceDir, '.docstube'), { recursive: true });
  await writeFile(path, `${JSON.stringify({ enabled }, null, 2)}\n`, 'utf8');
};

export const discloseRuntimeTelemetryOnFirstRun = async (
  input: {
    env?: NodeJS.ProcessEnv;
    now?: () => Date;
    onDisclosure?: (message: string) => void;
    workspaceDir?: string;
  } = {}
): Promise<RuntimeTelemetryDisclosureResult> => {
  const env = input.env ?? process.env;
  const workspaceDir = input.workspaceDir ?? process.cwd();
  if (envDisablesTelemetry(env) || envHasTelemetryPreference(env)) {
    return { disclosed: false };
  }

  try {
    await readFile(telemetryPath(workspaceDir), 'utf8');
    return { disclosed: false };
  } catch {
    await mkdir(join(workspaceDir, '.docstube'), { recursive: true });
    await writeFile(
      telemetryPath(workspaceDir),
      `${JSON.stringify({ enabled: true, disclosedAt: (input.now ?? (() => new Date()))().toISOString() }, null, 2)}\n`,
      'utf8'
    );
    input.onDisclosure?.(runtimeTelemetryDisclosureMessage);
    return { disclosed: true };
  }
};

export const createPostHogRuntimeTelemetryTransport =
  (env: NodeJS.ProcessEnv = process.env): RuntimeTelemetryTransport =>
  async (event) => {
    const token = env.DOCSTUBE_POSTHOG_PROJECT_TOKEN ?? env.POSTHOG_PROJECT_TOKEN;
    if (!token) {
      return;
    }

    const host = (env.DOCSTUBE_POSTHOG_HOST ?? env.POSTHOG_HOST ?? 'https://us.i.posthog.com').replace(/\/+$/u, '');
    await fetch(`${host}/capture/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        api_key: token,
        event: 'docstube cli command',
        properties: event
      })
    });
  };

export const sendRuntimeTelemetry = async (input: {
  event: RuntimeTelemetryEvent;
  env?: NodeJS.ProcessEnv;
  transport?: RuntimeTelemetryTransport;
  workspaceDir?: string;
}): Promise<{ sent: boolean }> => {
  if (!(await readRuntimeTelemetryEnabled(input.workspaceDir, input.env))) {
    return { sent: false };
  }

  try {
    await (input.transport ?? createPostHogRuntimeTelemetryTransport(input.env))(input.event);
    return { sent: true };
  } catch {
    return { sent: false };
  }
};

export const runCliCommandWithTelemetry = async (input: {
  command: string;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  onDisclosure?: (message: string) => void;
  run: () => Promise<RuntimeTelemetryCommandResult> | RuntimeTelemetryCommandResult;
  transport?: RuntimeTelemetryTransport;
  workspaceDir?: string;
}): Promise<RuntimeTelemetryCommandResult> => {
  const now = input.now ?? Date.now;
  const startedAt = now();

  await discloseRuntimeTelemetryOnFirstRun({
    workspaceDir: input.workspaceDir,
    env: input.env,
    onDisclosure: input.onDisclosure
  });

  await sendRuntimeTelemetry({
    workspaceDir: input.workspaceDir,
    env: input.env,
    event: createRuntimeTelemetryEvent({ command: input.command, status: 'started' }),
    transport: input.transport
  });

  try {
    const result = await input.run();
    const durationMs = Math.max(0, Math.round(now() - startedAt));
    await sendRuntimeTelemetry({
      workspaceDir: input.workspaceDir,
      env: input.env,
      event: createRuntimeTelemetryEvent({
        command: input.command,
        durationMs,
        errorKind: result.exitCode === 0 ? undefined : 'command-failed',
        status: result.exitCode === 0 ? 'succeeded' : 'failed'
      }),
      transport: input.transport
    });
    return result;
  } catch (error) {
    const durationMs = Math.max(0, Math.round(now() - startedAt));
    await sendRuntimeTelemetry({
      workspaceDir: input.workspaceDir,
      env: input.env,
      event: createRuntimeTelemetryEvent({
        command: input.command,
        durationMs,
        errorKind: 'exception',
        status: 'failed'
      }),
      transport: input.transport
    });
    throw error;
  }
};
