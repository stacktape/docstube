import { copyFile, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createRuntimeTelemetryEvent,
  runCheckAllCommand,
  runCheckCommand,
  runGenerateCommand,
  runRefreshCommand,
  runValidateCommand,
  runWizardCommand,
  sendRuntimeTelemetry,
  writeRuntimeTelemetryEnabled
} from './cli-commands.ts';
import type { CliOutput, RuntimeTelemetryEvent } from './cli-commands.ts';

const fixturePath = (name: string): string =>
  fileURLToPath(new URL(`../../../packages/core/src/fixtures/${name}`, import.meta.url));

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const withWorkspace = async (run: (dir: string) => Promise<void>) => {
  const dir = await mkdtemp(join(tmpdir(), 'docstube-cli-'));
  try {
    await Promise.all([
      copyFile(fixturePath('docstube.yml'), join(dir, 'docstube.yml')),
      copyFile(fixturePath('ia.yml'), join(dir, 'ia.yml')),
      copyFile(fixturePath('glossary.yaml'), join(dir, 'glossary.yaml'))
    ]);
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

const captureOutput = (): { lines: string[]; output: CliOutput } => {
  const lines: string[] = [];
  return {
    lines,
    output: {
      info: (message) => lines.push(`info:${message}`),
      error: (message) => lines.push(`error:${message}`)
    }
  };
};

describe('CLI commands', () => {
  it('opens the wizard control plane and resumes existing local state', async () => {
    await withWorkspace(async (dir) => {
      await mkdir(join(dir, '.docstube'), { recursive: true });
      await writeFile(join(dir, '.docstube', 'db.sqlite'), '', 'utf8');
      const { lines, output } = captureOutput();
      const startOptions: unknown[] = [];
      const result = await runWizardCommand(
        {
          workspaceDir: dir,
          uiDevServerUrl: 'http://127.0.0.1:5173',
          start: async (input) => {
            startOptions.push(input);
            return {
              host: '127.0.0.1',
              port: 1234,
              sessionToken: 'token',
              url: 'http://127.0.0.1:1234/wizard?session=token',
              close: async () => {}
            };
          }
        },
        output
      );

      expect(result.exitCode).toBe(0);
      expect(lines).toContain('info:Resuming existing local wizard state.');
      expect(lines).toContain('info:Started local control plane: http://127.0.0.1:1234/wizard?session=token');
      expect(startOptions).toEqual([
        {
          openBrowser: undefined,
          uiDevServerUrl: 'http://127.0.0.1:5173',
          workspaceDir: dir
        }
      ]);
    });
  });

  it('supports wizard --fresh by deleting only machine-local SQLite state', async () => {
    await withWorkspace(async (dir) => {
      await mkdir(join(dir, '.docstube'), { recursive: true });
      await Promise.all([
        writeFile(join(dir, '.docstube', 'db.sqlite'), 'state', 'utf8'),
        writeFile(join(dir, '.docstube', 'db.sqlite-wal'), 'state', 'utf8'),
        writeFile(join(dir, '.docstube', 'db.sqlite-shm'), 'state', 'utf8')
      ]);
      const { lines, output } = captureOutput();
      const result = await runWizardCommand(
        {
          workspaceDir: dir,
          fresh: true,
          start: async () => ({
            host: '127.0.0.1',
            port: 1234,
            sessionToken: 'token',
            url: 'http://127.0.0.1:1234/wizard?session=token',
            close: async () => {}
          })
        },
        output
      );

      expect(result.exitCode).toBe(0);
      expect(lines).toContain('info:Discarded local wizard state.');
      expect(await pathExists(join(dir, '.docstube', 'db.sqlite'))).toBe(false);
      expect(await pathExists(join(dir, '.docstube', 'db.sqlite-wal'))).toBe(false);
      expect(await pathExists(join(dir, '.docstube', 'db.sqlite-shm'))).toBe(false);
      expect(await pathExists(join(dir, 'docstube.yml'))).toBe(true);
    });
  });

  it('starts generation from existing config without opening the wizard', async () => {
    await withWorkspace(async (dir) => {
      const { lines, output } = captureOutput();
      await expect(runGenerateCommand({ workspaceDir: dir }, output)).resolves.toEqual({ exitCode: 0 });
      expect(lines.some((line) => line.includes('Initialized 2 pages for run-'))).toBe(true);
      expect(lines).toContain(
        'info:Generation pipeline is queued from config; page writing is implemented by the pipeline tasks.'
      );
    });
  });

  it('validates config-family success and failure cases', async () => {
    await withWorkspace(async (dir) => {
      const success = captureOutput();
      await expect(runValidateCommand({ workspaceDir: dir }, success.output)).resolves.toEqual({ exitCode: 0 });
      expect(success.lines).toContain('info:config-family: passed');

      await copyFile(fixturePath('docstube.invalid.yml'), join(dir, 'docstube.yml'));
      const failed = captureOutput();
      await expect(runValidateCommand({ workspaceDir: dir }, failed.output)).resolves.toEqual({ exitCode: 1 });
      expect(failed.lines.some((line) => line.startsWith('error:major:'))).toBe(true);
    });
  });

  it('runs deterministic check commands over files', async () => {
    await withWorkspace(async (dir) => {
      const mdxPath = join(dir, 'page.mdx');
      await writeFile(mdxPath, '# Hello\n\n<Broken', 'utf8');
      const output = captureOutput();
      const result = await runCheckCommand({ workspaceDir: dir, kind: 'mdx', file: mdxPath }, output.output);

      expect(result.exitCode).toBe(1);
      expect(output.lines).toContain('info:mdx-compile: failed');
      expect(output.lines.some((line) => line.startsWith('error:major:'))).toBe(true);
    });
  });

  it('runs all available deterministic checks over the project', async () => {
    await withWorkspace(async (dir) => {
      await mkdir(join(dir, 'docs'), { recursive: true });
      await writeFile(join(dir, 'docs', 'page.mdx'), '# Hello\n\nWorld\n', 'utf8');
      const output = captureOutput();

      await expect(runCheckAllCommand({ workspaceDir: dir }, output.output)).resolves.toEqual({ exitCode: 0 });
      expect(output.lines).toContain('info:config-family: passed');
      expect(output.lines).toContain('info:mdx-compile: passed');
    });
  });

  it('loads a portable manifest for refresh', async () => {
    await withWorkspace(async (dir) => {
      await mkdir(join(dir, '.docstube'), { recursive: true });
      await writeFile(
        join(dir, '.docstube', 'manifest.yml'),
        'version: 1\ngeneratedWith:\n  name: docstube\n  version: 0.0.0\npages: []\n',
        'utf8'
      );
      const { lines, output } = captureOutput();

      await expect(runRefreshCommand({ workspaceDir: dir }, output)).resolves.toEqual({ exitCode: 0 });
      expect(lines).toContain('info:Loaded manifest with 0 pages.');
      expect(lines).toContain(
        'info:Refresh checks all pages by default, regenerates stale pages, and updates vendored theme assets.'
      );
      expect(lines).toContain('info:Refresh engine is ready to resolve stale pages.');
    });
  });

  it('keeps runtime telemetry opt-in and never sends forbidden runtime data', async () => {
    await withWorkspace(async (dir) => {
      await writeRuntimeTelemetryEnabled(dir, true);

      const sent: RuntimeTelemetryEvent[] = [];
      const event = createRuntimeTelemetryEvent({ command: 'generate', status: 'succeeded' });
      const result = await sendRuntimeTelemetry({
        workspaceDir: dir,
        event,
        transport: (payload) => {
          sent.push(payload);
        }
      });

      expect(result.sent).toBe(true);
      expect(sent).toEqual([event]);
      const serialized = JSON.stringify(sent);
      for (const forbidden of ['sk-', 'prompt', 'file', 'path', 'config', 'source', 'transcript', 'secret']) {
        expect(serialized).not.toContain(forbidden);
      }

      await writeRuntimeTelemetryEnabled(dir, false);
      const disabled = await sendRuntimeTelemetry({
        workspaceDir: dir,
        event,
        transport: (payload) => {
          sent.push(payload);
        }
      });
      expect(disabled.sent).toBe(false);
    });
  });
});
