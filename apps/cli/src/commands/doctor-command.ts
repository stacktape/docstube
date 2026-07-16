import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CoreError, detectProject, loadConfigFamily } from '@docstube/core';
import type { CliCommandResult, CliOutput } from '../cli-output.ts';

const execFileAsync = promisify(execFile);

export type DoctorCommandInput = {
  workspaceDir: string;
};

type DoctorCheck = { name: string; ok: boolean; detail: string; critical: boolean };

const binaryAvailable = async (binary: string): Promise<boolean> => {
  try {
    await execFileAsync(binary, ['--version'], { timeout: 10_000, shell: process.platform === 'win32' });
    return true;
  } catch {
    return false;
  }
};

export const runDoctorCommand = async (input: DoctorCommandInput, output: CliOutput): Promise<CliCommandResult> => {
  const checks: DoctorCheck[] = [];

  const [nodeMajor = 0] = process.versions.node.split('.').map(Number);
  checks.push({
    name: 'node',
    ok: nodeMajor >= 24,
    detail: `v${process.versions.node} (need >= 24)`,
    critical: true
  });
  checks.push({
    name: 'git',
    ok: await binaryAvailable('git'),
    detail: 'required for provenance commits',
    critical: true
  });

  const detection = await detectProject(input.workspaceDir);
  checks.push({
    name: 'project detection',
    ok: detection.languages.length > 0,
    detail:
      detection.languages.length > 0
        ? `${detection.languages.join(', ')}${detection.docType ? ` · looks like ${detection.docType}` : ''}${detection.monorepo ? ' · monorepo' : ''}`
        : 'no supported language detected (TypeScript, Python, Java)',
    critical: false
  });

  try {
    const family = await loadConfigFamily(input.workspaceDir);
    checks.push({ name: 'config family', ok: true, detail: 'docstube.yml + ia.yml valid', critical: true });

    const transport = family.config.agents.transport;
    if (transport === 'claude-cli') {
      checks.push({
        name: 'claude CLI',
        ok: await binaryAvailable('claude'),
        detail: 'agents.transport = claude-cli',
        critical: true
      });
    } else if (transport === 'codex-cli') {
      checks.push({
        name: 'codex CLI',
        ok: await binaryAvailable('codex'),
        detail: 'agents.transport = codex-cli',
        critical: true
      });
    } else if (transport === 'anthropic-api' || transport === 'openai-compatible') {
      const envName = family.config.agents.apiKeyEnv;
      checks.push({
        name: 'api credential',
        ok: envName !== undefined && process.env[envName] !== undefined && process.env[envName] !== '',
        detail: envName === undefined ? 'agents.apiKeyEnv not set' : `env ${envName}`,
        critical: true
      });
    }
  } catch (error) {
    checks.push({
      name: 'config family',
      ok: false,
      detail: error instanceof CoreError ? (error.message.split('\n')[0] ?? 'invalid') : 'unreadable',
      critical: false
    });
  }

  let failedCritical = false;
  for (const check of checks) {
    output.info(`${check.ok ? 'ok  ' : 'FAIL'}  ${check.name} — ${check.detail}`);
    if (!check.ok && check.critical) {
      failedCritical = true;
    }
  }
  return { exitCode: failedCritical ? 1 : 0 };
};
