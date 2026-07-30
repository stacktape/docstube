import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ciPreflightReportSchema } from '@docstube/contracts';
import type { CliOutput } from '../cli-output.ts';
import { runDoctorCommand } from './doctor-command.ts';

let workspaceDir: string;
let lines: string[];
const output: CliOutput = {
  info: (message) => lines.push(message),
  error: (message) => lines.push(message)
};

const validConfig = `schemaVersion: 1
docType: external-library
personas:
  - id: app-developer
    description: Builds apps
site:
  title: Fixture
agents:
  transport: anthropic-api
`;

const validIa = `schemaVersion: 1
tree:
  - title: Getting started
    slug: getting-started
    brief: How to install and run.
`;

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
    await writeFile(join(workspaceDir, 'ia.yml'), validIa, 'utf8');
    const result = await runDoctorCommand({ workspaceDir }, output);
    expect(result.exitCode).toBe(1);
    expect(lines.join('\n')).toContain('FAIL  config family');
  }, 30_000);

  it('--json emits exactly one report that satisfies the versioned contract', async () => {
    await writeFile(join(workspaceDir, 'docstube.yml'), validConfig, 'utf8');
    await writeFile(join(workspaceDir, 'ia.yml'), validIa, 'utf8');

    const result = await runDoctorCommand(
      {
        workspaceDir,
        ci: true,
        json: true,
        env: { ANTHROPIC_API_KEY: 'sk-ant-fixture' },
        probeBinary: async () => true,
        now: () => new Date('2026-07-29T00:00:00.000Z')
      },
      output
    );

    expect(result.exitCode).toBe(0);
    expect(lines).toHaveLength(1);
    const report = ciPreflightReportSchema.parse(JSON.parse(lines[0] ?? ''));
    expect(report).toMatchObject({
      schemaVersion: 1,
      generatedAt: '2026-07-29T00:00:00.000Z',
      mode: 'ci',
      // No GitHub Actions context in this environment: unknown, never a promised full-auto.
      automationMode: 'unknown',
      ok: true,
      fatal: []
    });
    const ids = report.checks.map((check) => check.id);
    expect(ids).toContain('transport-credential');
    expect(ids).toContain('auto-merge-token-mode');
    // Nothing on stdout but the report — the Action parses this stream.
    expect(lines[0]?.trimStart().startsWith('{')).toBe(true);
  }, 30_000);

  it('a local run outside GitHub still succeeds, with the GitHub half reported as unknown', async () => {
    await writeFile(join(workspaceDir, 'docstube.yml'), validConfig, 'utf8');
    await writeFile(join(workspaceDir, 'ia.yml'), validIa, 'utf8');

    const result = await runDoctorCommand(
      { workspaceDir, ci: true, env: { ANTHROPIC_API_KEY: 'sk-ant-fixture' }, probeBinary: async () => true },
      output
    );

    expect(result.exitCode).toBe(0);
    const rendered = lines.join('\n');
    expect(rendered).toContain('?     github context — not running in a GitHub Actions context');
    expect(rendered).toContain('Automation mode: unknown');
  }, 30_000);
});
