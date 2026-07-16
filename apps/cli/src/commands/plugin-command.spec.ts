import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CliOutput } from '../cli-output.ts';
import { runPluginCommand } from './plugin-command.ts';

let workspaceDir: string;
let lines: string[];
let errors: string[];
const output: CliOutput = {
  info: (message) => lines.push(message),
  error: (message) => errors.push(message)
};

beforeEach(async () => {
  workspaceDir = await mkdtemp(join(tmpdir(), 'docstube-plugin-'));
  lines = [];
  errors = [];
});

afterEach(async () => {
  await rm(workspaceDir, { recursive: true, force: true });
});

describe('plugin scaffold', () => {
  it('writes a renamed starter plugin, its spec, and the plugin-authoring skill', async () => {
    const result = await runPluginCommand({ workspaceDir, action: 'scaffold', name: 'linkstats' }, output);
    expect(result.exitCode).toBe(0);

    const pluginSource = await readFile(join(workspaceDir, 'plugins', 'linkstats.ts'), 'utf8');
    expect(pluginSource).toContain('definePlugin({');
    expect(pluginSource).toContain('linkstats');
    expect(pluginSource).not.toContain('wordcount');
    const specSource = await readFile(join(workspaceDir, 'plugins', 'linkstats.spec.ts'), 'utf8');
    expect(specSource).toContain('linkstats');
    const skill = await readFile(join(workspaceDir, '.docstube', 'skills', 'plugin-authoring', 'SKILL.md'), 'utf8');
    expect(skill).toContain('definePlugin');
    expect(lines.join('\n')).toContain('plugins:\n         - ./plugins/linkstats.ts');
  });

  it('refuses to overwrite an existing plugin and rejects unknown actions', async () => {
    await runPluginCommand({ workspaceDir, action: 'scaffold', name: 'dup' }, output);
    const second = await runPluginCommand({ workspaceDir, action: 'scaffold', name: 'dup' }, output);
    expect(second.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('already exists');

    const unknown = await runPluginCommand({ workspaceDir, action: 'publish' }, output);
    expect(unknown.exitCode).toBe(1);
  });
});
