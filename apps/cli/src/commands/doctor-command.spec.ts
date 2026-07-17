import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CliOutput } from '../cli-output.ts';
import { runDoctorCommand } from './doctor-command.ts';

let workspaceDir: string;
let lines: string[];
const output: CliOutput = {
  info: (message) => lines.push(message),
  error: (message) => lines.push(message)
};

beforeEach(async () => {
  workspaceDir = await mkdtemp(join(tmpdir(), 'docstube-doctor-'));
  lines = [];
});

afterEach(async () => {
  await rm(workspaceDir, { recursive: true, force: true });
});

describe('doctor command', () => {
  it('exits non-zero on an invalid docstube.yml — an unusable project is a critical failure', async () => {
    await writeFile(join(workspaceDir, 'docstube.yml'), 'schemaVersion: 1\ndocType: nope\n', 'utf8');
    await writeFile(
      join(workspaceDir, 'ia.yml'),
      'schemaVersion: 1\ntree:\n  - title: Getting started\n    slug: getting-started\n    brief: Install.\n',
      'utf8'
    );
    const result = await runDoctorCommand({ workspaceDir }, output);
    expect(result.exitCode).toBe(1);
    expect(lines.join('\n')).toContain('FAIL  config family');
  }, 30_000);
});
