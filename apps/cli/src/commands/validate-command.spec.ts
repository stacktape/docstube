import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CliOutput } from '../cli-output.ts';
import { runValidateCommand } from './validate-command.ts';

let workspaceDir: string;
let lines: string[];
let errors: string[];
const output: CliOutput = {
  info: (message) => lines.push(message),
  error: (message) => errors.push(message)
};

const validConfig = `schemaVersion: 1
docType: external-library
personas:
  - id: app-developer
    description: Builds apps
site:
  title: Fixture
`;

const validIa = `schemaVersion: 1
tree:
  - title: Getting started
    slug: getting-started
    brief: How to install and run.
`;

beforeEach(async () => {
  workspaceDir = await mkdtemp(join(tmpdir(), 'docstube-cli-'));
  lines = [];
  errors = [];
});

afterEach(async () => {
  await rm(workspaceDir, { recursive: true, force: true });
});

describe('validate command', () => {
  it('passes on a valid config family', async () => {
    await writeFile(join(workspaceDir, 'docstube.yml'), validConfig);
    await writeFile(join(workspaceDir, 'ia.yml'), validIa);
    const result = await runValidateCommand({ workspaceDir }, output);
    expect(result.exitCode).toBe(0);
    expect(lines.join('\n')).toContain('docstube.yml OK');
  });

  it('fails with a readable error when config is missing', async () => {
    const result = await runValidateCommand({ workspaceDir }, output);
    expect(result.exitCode).toBe(1);
    expect(errors[0]).toContain('docstube wizard');
  });

  it('fails with the offending path on schema violations', async () => {
    await writeFile(join(workspaceDir, 'docstube.yml'), validConfig.replace('external-library', 'nope'));
    await writeFile(join(workspaceDir, 'ia.yml'), validIa);
    const result = await runValidateCommand({ workspaceDir }, output);
    expect(result.exitCode).toBe(1);
    expect(errors[0]).toContain('docType');
  });
});
