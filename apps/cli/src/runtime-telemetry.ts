import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { FailureModeCode } from '@docstube/contracts';
import { toFailureModeCode } from '@docstube/contracts';
import { telemetryPath } from './workspace-paths.ts';

const docstubeVersion = '0.0.2';

export type RuntimeTelemetryErrorKind = 'command-failed' | 'exception';

export type RuntimeTelemetryStatus = 'failed' | 'started' | 'succeeded';

export type RuntimeTelemetryEvent = {
  command: string;
  durationMs?: number;
  errorKind?: RuntimeTelemetryErrorKind;
  event: 'cli-command';
  // ONLY fixed registry codes with counts — never free text (contracts/failure-modes.ts).
  failureModes?: Partial<Record<FailureModeCode, number>>;
  surface: 'runtime';
  status: RuntimeTelemetryStatus;
  version: string;
};

export type RuntimeTelemetryTransport = (
  event: RuntimeTelemetryEvent,
  context: { distinctId: string }
) => Promise<void> | void;

export type RuntimeTelemetryCommandResult = {
  exitCode: number;
  // Coarse failure-mode counts from the run summary; forwarded into the final telemetry event.
  failureModes?: Partial<Record<FailureModeCode, number>> | undefined;
};

export type RuntimeTelemetryDisclosureResult = {
  disclosed: boolean;
};

const knownRuntimeTelemetryCommands = new Set([
  'answer',
  'audit',
  'check',
  'doctor',
  'generate',
  'help',
  'plugin',
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

// The disclosure lists EXACTLY what is sent — keep it in lockstep with RuntimeTelemetryEvent.
const runtimeTelemetryDisclosureMessage =
  'docstube collects privacy-preserving runtime telemetry by default: the command name, its duration, a coarse ' +
  'error kind, coarse failure-mode counts, and the docstube version, under a random anonymous id. It never sends ' +
  'source code, prompts, generated docs, paths, project names, repo contents, or secrets. Nothing is sent for this ' +
  'first run. Disable it with DOCSTUBE_TELEMETRY=false or DO_NOT_TRACK=1.';

// The preference is per-user (one opt-in/out and one anonymous id across every repo), stored at
// ~/.config/docstube/telemetry.json on every platform. The old per-workspace
// .docstube/telemetry.json is honored for its opt-out and silently migrated otherwise.
export const defaultUserTelemetryDir = (): string => join(homedir(), '.config', 'docstube');

export const userTelemetryPath = (userConfigDir: string = defaultUserTelemetryDir()): string =>
  join(userConfigDir, 'telemetry.json');

export type TelemetryPreference = {
  enabled: boolean;
  // Anonymous per-user id (crypto.randomUUID) — PostHog's distinct_id. Never derived from the
  // machine, user name, or repo.
  distinctId: string;
  disclosedAt?: string;
};

const readJsonFile = async (path: string): Promise<Record<string, unknown> | undefined> => {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
};

const writePreference = async (path: string, preference: TelemetryPreference): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(preference, null, 2)}\n`, 'utf8');
};

export type ResolvedTelemetryPreference = {
  preference: TelemetryPreference;
  // True only when NO preference file existed anywhere — the notice-first run: disclose, persist,
  // and send nothing.
  firstRun: boolean;
};

export const resolveTelemetryPreference = async (
  input: { userConfigDir?: string | undefined; workspaceDir?: string | undefined; now?: (() => Date) | undefined } = {}
): Promise<ResolvedTelemetryPreference> => {
  const path = userTelemetryPath(input.userConfigDir);
  const perUser = await readJsonFile(path);
  if (perUser !== undefined && typeof perUser.enabled === 'boolean') {
    if (typeof perUser.distinctId === 'string' && perUser.distinctId.length > 0) {
      return { preference: perUser as unknown as TelemetryPreference, firstRun: false };
    }
    // Older per-user files without an id: backfill one so events stop being dropped/mis-bucketed.
    const preference: TelemetryPreference = { ...perUser, enabled: perUser.enabled, distinctId: crypto.randomUUID() };
    await writePreference(path, preference);
    return { preference, firstRun: false };
  }

  const legacy = await readJsonFile(telemetryPath(input.workspaceDir ?? process.cwd()));
  if (legacy !== undefined && typeof legacy.enabled === 'boolean') {
    // Never re-enable someone who opted out; otherwise migrate silently (they already saw the
    // disclosure when the legacy file was created).
    const preference: TelemetryPreference = { enabled: legacy.enabled, distinctId: crypto.randomUUID() };
    await writePreference(path, preference);
    return { preference, firstRun: false };
  }

  const preference: TelemetryPreference = {
    enabled: true,
    distinctId: crypto.randomUUID(),
    disclosedAt: (input.now ?? (() => new Date()))().toISOString()
  };
  await writePreference(path, preference);
  return { preference, firstRun: true };
};

export const writeRuntimeTelemetryEnabled = async (enabled: boolean, userConfigDir?: string): Promise<void> => {
  const path = userTelemetryPath(userConfigDir);
  const existing = await readJsonFile(path);
  const distinctId =
    typeof existing?.distinctId === 'string' && existing.distinctId.length > 0
      ? existing.distinctId
      : crypto.randomUUID();
  await writePreference(path, { enabled, distinctId });
};

export const createRuntimeTelemetryEvent = (input: {
  command: string;
  durationMs?: number;
  errorKind?: RuntimeTelemetryErrorKind;
  failureModes?: Partial<Record<FailureModeCode, number>> | undefined;
  status: RuntimeTelemetryStatus;
}): RuntimeTelemetryEvent => ({
  event: 'cli-command',
  command: normalizedCommandName(input.command),
  durationMs: input.durationMs,
  errorKind: input.errorKind,
  ...(input.failureModes === undefined ? {} : { failureModes: input.failureModes }),
  status: input.status,
  version: docstubeVersion,
  surface: 'runtime'
});

// Aggregates a run summary into registry-code counts for the telemetry payload. Inputs are the
// raw finding checks / open flag kinds; toFailureModeCode guarantees only registry codes leave.
export const countRunFailureModes = (input: {
  findingChecks?: readonly string[] | undefined;
  openFlagKinds?: readonly string[] | undefined;
  frozen?: boolean | undefined;
}): Partial<Record<FailureModeCode, number>> | undefined => {
  const counts: Partial<Record<FailureModeCode, number>> = {};
  const bump = (code: FailureModeCode) => {
    counts[code] = (counts[code] ?? 0) + 1;
  };
  for (const check of input.findingChecks ?? []) {
    bump(toFailureModeCode({ check }));
  }
  for (const flagKind of input.openFlagKinds ?? []) {
    bump(toFailureModeCode({ flagKind }));
  }
  if (input.frozen === true) {
    bump(toFailureModeCode({ errorKind: 'frozen-budget' }));
  }
  return Object.keys(counts).length > 0 ? counts : undefined;
};

export const createPostHogRuntimeTelemetryTransport =
  (env: NodeJS.ProcessEnv = process.env): RuntimeTelemetryTransport =>
  async (event, context) => {
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
        distinct_id: context.distinctId,
        properties: event
      })
    });
  };

export const sendRuntimeTelemetry = async (input: {
  event: RuntimeTelemetryEvent;
  distinctId: string;
  env?: NodeJS.ProcessEnv;
  transport?: RuntimeTelemetryTransport;
}): Promise<{ sent: boolean }> => {
  try {
    await (input.transport ?? createPostHogRuntimeTelemetryTransport(input.env))(input.event, {
      distinctId: input.distinctId
    });
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
  userConfigDir?: string;
  workspaceDir?: string;
}): Promise<RuntimeTelemetryCommandResult> => {
  const env = input.env ?? process.env;
  const now = input.now ?? Date.now;
  const startedAt = now();

  // Env kill-switches and explicit env preferences never touch disk and never disclose.
  let enabled = !envDisablesTelemetry(env);
  let firstRun = false;
  let distinctId: string | undefined;
  if (enabled && !envHasTelemetryPreference(env)) {
    const resolved = await resolveTelemetryPreference({
      userConfigDir: input.userConfigDir,
      workspaceDir: input.workspaceDir
    });
    enabled = resolved.preference.enabled;
    firstRun = resolved.firstRun;
    distinctId = resolved.preference.distinctId;
    if (firstRun) {
      input.onDisclosure?.(runtimeTelemetryDisclosureMessage);
    }
  } else if (enabled) {
    // DOCSTUBE_TELEMETRY=true: honor it without a disclosure, but still keep one stable
    // anonymous id per user.
    const resolved = await resolveTelemetryPreference({
      userConfigDir: input.userConfigDir,
      workspaceDir: input.workspaceDir
    });
    distinctId = resolved.preference.distinctId;
    firstRun = resolved.firstRun;
  }

  // Notice-first: the disclosure run itself sends NOTHING — events start from the next run.
  const shouldSend = enabled && !firstRun && distinctId !== undefined;
  const send = async (event: RuntimeTelemetryEvent) => {
    if (!shouldSend || distinctId === undefined) {
      return;
    }
    await sendRuntimeTelemetry({ event, distinctId, env, ...(input.transport ? { transport: input.transport } : {}) });
  };

  await send(createRuntimeTelemetryEvent({ command: input.command, status: 'started' }));

  try {
    const result = await input.run();
    const durationMs = Math.max(0, Math.round(now() - startedAt));
    await send(
      createRuntimeTelemetryEvent({
        command: input.command,
        durationMs,
        errorKind: result.exitCode === 0 ? undefined : 'command-failed',
        failureModes: result.failureModes,
        status: result.exitCode === 0 ? 'succeeded' : 'failed'
      })
    );
    return result;
  } catch (error) {
    const durationMs = Math.max(0, Math.round(now() - startedAt));
    await send(
      createRuntimeTelemetryEvent({
        command: input.command,
        durationMs,
        errorKind: 'exception',
        status: 'failed'
      })
    );
    throw error;
  }
};
