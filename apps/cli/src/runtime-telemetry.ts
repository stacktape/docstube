import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { docstubeVersion } from '@docstube/core';
import { telemetryPath } from './workspace-paths.ts';

export type RuntimeTelemetryStatus = 'failed' | 'started' | 'succeeded';

export type RuntimeTelemetryEvent = {
  command: string;
  event: 'cli-command';
  surface: 'runtime';
  status: RuntimeTelemetryStatus;
  version: string;
};

export type RuntimeTelemetryTransport = (event: RuntimeTelemetryEvent) => Promise<void> | void;

export const createRuntimeTelemetryEvent = (input: {
  command: string;
  status: RuntimeTelemetryStatus;
}): RuntimeTelemetryEvent => ({
  event: 'cli-command',
  command: input.command,
  status: input.status,
  version: docstubeVersion,
  surface: 'runtime'
});

export const readRuntimeTelemetryEnabled = async (workspaceDir = process.cwd()): Promise<boolean> => {
  try {
    const parsed = JSON.parse(await readFile(telemetryPath(workspaceDir), 'utf8')) as { enabled?: unknown };
    return parsed.enabled === true;
  } catch {
    return false;
  }
};

export const writeRuntimeTelemetryEnabled = async (workspaceDir: string, enabled: boolean): Promise<void> => {
  const path = telemetryPath(workspaceDir);
  await mkdir(join(workspaceDir, '.docstube'), { recursive: true });
  await writeFile(path, `${JSON.stringify({ enabled }, null, 2)}\n`, 'utf8');
};

export const sendRuntimeTelemetry = async (input: {
  event: RuntimeTelemetryEvent;
  transport: RuntimeTelemetryTransport;
  workspaceDir?: string;
}): Promise<{ sent: boolean }> => {
  if (!(await readRuntimeTelemetryEnabled(input.workspaceDir))) {
    return { sent: false };
  }

  await input.transport(input.event);
  return { sent: true };
};
