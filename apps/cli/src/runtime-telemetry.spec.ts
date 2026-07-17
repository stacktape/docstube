import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { failureModeCodes } from '@docstube/contracts';
import type { FailureModeCode } from '@docstube/contracts';
import {
  countRunFailureModes,
  createPostHogRuntimeTelemetryTransport,
  runCliCommandWithTelemetry,
  userTelemetryPath
} from './runtime-telemetry.ts';
import type { RuntimeTelemetryEvent } from './runtime-telemetry.ts';

let workspaceDir: string;
let userConfigDir: string;

beforeEach(async () => {
  workspaceDir = await mkdtemp(join(tmpdir(), 'docstube-telemetry-ws-'));
  userConfigDir = await mkdtemp(join(tmpdir(), 'docstube-telemetry-user-'));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(workspaceDir, { recursive: true, force: true });
  await rm(userConfigDir, { recursive: true, force: true });
});

type Captured = { event: RuntimeTelemetryEvent; distinctId: string };

const runOnce = async (
  input: {
    env?: NodeJS.ProcessEnv;
    exitCode?: number;
    failureModes?: Partial<Record<FailureModeCode, number>>;
    onDisclosure?: (message: string) => void;
  } = {}
): Promise<Captured[]> => {
  const captured: Captured[] = [];
  await runCliCommandWithTelemetry({
    command: 'generate',
    env: input.env ?? {},
    workspaceDir,
    userConfigDir,
    onDisclosure: input.onDisclosure,
    transport: (event, context) => {
      captured.push({ event, distinctId: context.distinctId });
    },
    run: () => ({
      exitCode: input.exitCode ?? 0,
      ...(input.failureModes === undefined ? {} : { failureModes: input.failureModes })
    })
  });
  return captured;
};

const readPreference = async (): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(userTelemetryPath(userConfigDir), 'utf8')) as Record<string, unknown>;

describe('notice-first behavior', () => {
  it('discloses on the very first invocation, persists the preference, and sends NO events that run', async () => {
    const disclosures: string[] = [];
    const firstRunEvents = await runOnce({ onDisclosure: (message) => disclosures.push(message) });

    expect(firstRunEvents).toEqual([]);
    expect(disclosures).toHaveLength(1);
    expect(disclosures[0]).toContain('failure-mode counts');
    expect(disclosures[0]).not.toContain('environment facts');

    const preference = await readPreference();
    expect(preference.enabled).toBe(true);
    expect(typeof preference.distinctId).toBe('string');

    // Events start from the next run, under the persisted anonymous id.
    const secondRunEvents = await runOnce();
    expect(secondRunEvents.map((entry) => entry.event.status)).toEqual(['started', 'succeeded']);
    expect(secondRunEvents[0]?.distinctId).toBe(preference.distinctId);
  });

  it('does not disclose twice', async () => {
    await runOnce();
    const disclosures: string[] = [];
    await runOnce({ onDisclosure: (message) => disclosures.push(message) });
    expect(disclosures).toEqual([]);
  });
});

describe('per-user preference and legacy migration', () => {
  it('honors an explicit legacy workspace opt-out and never re-enables it', async () => {
    await mkdir(join(workspaceDir, '.docstube'), { recursive: true });
    await writeFile(join(workspaceDir, '.docstube', 'telemetry.json'), JSON.stringify({ enabled: false }), 'utf8');

    const disclosures: string[] = [];
    const events = await runOnce({ onDisclosure: (message) => disclosures.push(message) });
    expect(events).toEqual([]);
    expect(disclosures).toEqual([]);
    expect((await readPreference()).enabled).toBe(false);

    // Still disabled on later runs.
    expect(await runOnce()).toEqual([]);
  });

  it('migrates a legacy enabled preference silently (no disclosure, events flow)', async () => {
    await mkdir(join(workspaceDir, '.docstube'), { recursive: true });
    await writeFile(join(workspaceDir, '.docstube', 'telemetry.json'), JSON.stringify({ enabled: true }), 'utf8');

    const disclosures: string[] = [];
    const events = await runOnce({ onDisclosure: (message) => disclosures.push(message) });
    expect(disclosures).toEqual([]);
    expect(events).toHaveLength(2);
    expect((await readPreference()).enabled).toBe(true);
  });

  it('respects DO_NOT_TRACK and DOCSTUBE_TELEMETRY=false without writing any preference file', async () => {
    for (const env of [{ DO_NOT_TRACK: '1' }, { DOCSTUBE_TELEMETRY: 'false' }]) {
      expect(await runOnce({ env })).toEqual([]);
    }
    await expect(readFile(userTelemetryPath(userConfigDir), 'utf8')).rejects.toThrow(/ENOENT/);
  });
});

describe('event payload', () => {
  it('carries duration, coarse error kind, and failure-mode counts on the final event', async () => {
    await runOnce();
    const events = await runOnce({ exitCode: 1, failureModes: { 'verify.typecheck-failed': 2 } });
    const final = events.at(-1)?.event;
    expect(final).toMatchObject({
      command: 'generate',
      status: 'failed',
      errorKind: 'command-failed',
      failureModes: { 'verify.typecheck-failed': 2 },
      version: expect.any(String)
    });
    expect(typeof final?.durationMs).toBe('number');
  });

  it('PostHog transport sends distinct_id at the payload top level', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
      return new Response('{}');
    });
    const transport = createPostHogRuntimeTelemetryTransport({ DOCSTUBE_POSTHOG_PROJECT_TOKEN: 'phc_test' });
    await transport(
      { event: 'cli-command', command: 'generate', status: 'succeeded', version: '0.0.2', surface: 'runtime' },
      { distinctId: 'anon-123' }
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body.distinct_id).toBe('anon-123');
    expect(calls[0]?.body.api_key).toBe('phc_test');
  });
});

describe('countRunFailureModes', () => {
  it('aggregates checks, flag kinds, and freezes into registry codes only', () => {
    const counts = countRunFailureModes({
      findingChecks: ['code-typecheck-ts', 'code-typecheck-ts', 'internal-links', 'something-weird'],
      openFlagKinds: ['system', 'tribal-knowledge'],
      frozen: true
    });
    expect(counts).toEqual({
      'verify.typecheck-failed': 2,
      'verify.links-broken': 1,
      'gate.exhausted': 1,
      'run.frozen-budget': 1,
      other: 2
    });
    const codes: string[] = [...failureModeCodes];
    for (const key of Object.keys(counts ?? {})) {
      expect(codes).toContain(key);
    }
  });

  it('returns undefined for a clean run', () => {
    expect(countRunFailureModes({})).toBeUndefined();
    expect(countRunFailureModes({ findingChecks: [], openFlagKinds: [], frozen: false })).toBeUndefined();
  });
});
