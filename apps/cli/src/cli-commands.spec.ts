import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createDeterministicProjectGenerationAdapters,
  generateProjectDocumentation,
  refreshProjectDocumentation
} from '@docstube/core';
import { runCheckAllCommand, runCheckCommand } from './commands/check-command.ts';
import { runGenerateCommand } from './commands/generate-command.ts';
import { runRefineCommand } from './commands/refine-command.ts';
import { runRefreshCommand } from './commands/refresh-command.ts';
import { runStatusCommand } from './commands/status-command.ts';
import { runUpgradeCommand } from './commands/upgrade-command.ts';
import { runValidateCommand } from './commands/validate-command.ts';
import { runWizardCommand } from './commands/wizard-command.ts';
import type { CliOutput } from './cli-output.ts';
import {
  createRuntimeTelemetryEvent,
  discloseRuntimeTelemetryOnFirstRun,
  readRuntimeTelemetryEnabled,
  runCliCommandWithTelemetry,
  sendRuntimeTelemetry,
  writeRuntimeTelemetryEnabled
} from './runtime-telemetry.ts';
import type { RuntimeTelemetryEvent } from './runtime-telemetry.ts';

const fixturePath = (name: string): string =>
  fileURLToPath(new URL(`../../../packages/core/src/fixtures/${name}`, import.meta.url));

const deterministicGenerate = (input: { configPath?: string; workspaceDir: string }) =>
  generateProjectDocumentation({ ...input, adapterFactory: createDeterministicProjectGenerationAdapters });

const deterministicRefresh = (input: { configPath?: string; workspaceDir: string }) =>
  refreshProjectDocumentation({ ...input, adapterFactory: createDeterministicProjectGenerationAdapters });

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

const sha256FileText = (content: Buffer, fileName: string): Buffer =>
  Buffer.from(`${createHash('sha256').update(content).digest('hex')}  ${fileName}\n`);

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
      await expect(runGenerateCommand({ workspaceDir: dir, generate: deterministicGenerate }, output)).resolves.toEqual(
        { exitCode: 0 }
      );
      expect(lines.some((line) => line.includes('Generated 2 pages for run-'))).toBe(true);
      expect(lines).toContain('info:Generated site assets: 8 files.');
      expect(lines).toContain(`info:passed: docs/src/pages/index.mdx`);
      await expect(readFile(join(dir, 'docs', 'src', 'pages', 'index.mdx'), 'utf8')).resolves.toContain('## Overview');
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
      const configPath = join(dir, 'docstube.yml');
      const config = await readFile(configPath, 'utf8');
      await writeFile(configPath, config.replace('dir: docs', 'dir: site-docs'), 'utf8');
      await mkdir(join(dir, 'site-docs'), { recursive: true });
      await writeFile(
        join(dir, 'site-docs', 'page.mdx'),
        [
          '---',
          'id: overview',
          'title: Overview',
          'sections:',
          '  - intro',
          'generated:',
          '  by: docstube',
          '  version: 0.0.2',
          '  at: 2026-01-01T00:00:00.000Z',
          '---',
          '# Hello',
          '',
          '{/* docstube:section:start id=intro */}',
          '',
          'World',
          '',
          '{/* docstube:section:end id=intro */}',
          ''
        ].join('\n'),
        'utf8'
      );
      const output = captureOutput();
      const doctorInputs: unknown[] = [];

      await expect(
        runCheckAllCommand(
          {
            workspaceDir: dir,
            runProjectDoctor: async (input) => {
              doctorInputs.push(input);
              return {
                ok: true,
                checks: [{ id: 'config', status: 'passed', message: 'docstube.yml trust gate passed' }]
              };
            }
          },
          output.output
        )
      ).resolves.toEqual({ exitCode: 0 });
      expect(output.lines).toContain('info:config-family: passed');
      expect(output.lines).toContain('info:config: passed - docstube.yml trust gate passed');
      expect(output.lines).toContain('info:generated-frontmatter: passed');
      expect(output.lines).toContain('info:page-section-ids: passed');
      expect(output.lines).toContain('info:section-presence: passed');
      expect(output.lines).toContain('info:mdx-compile: passed');
      expect(output.lines).toContain('info:component-props: passed');
      expect(output.lines).toContain('info:typescript-snippet: skipped');
      expect(output.lines).toContain('info:api-reference-consistency: skipped');
      expect(doctorInputs).toEqual([{ configPath: 'docstube.yml', workspaceDir: dir }]);
      expect(output.lines.some((line) => line.includes('No docs/*.mdx'))).toBe(false);
    });
  });

  it('fails check --all when project validation cannot trust the config family', async () => {
    await withWorkspace(async (dir) => {
      await rm(join(dir, 'docstube.yml'));
      const output = captureOutput();

      await expect(
        runCheckAllCommand(
          {
            workspaceDir: dir,
            runProjectDoctor: async () => ({
              ok: false,
              checks: [{ id: 'config', status: 'failed', message: 'missing docstube.yml' }]
            })
          },
          output.output
        )
      ).resolves.toEqual({ exitCode: 1 });
      expect(output.lines).toContain('error:No docstube.yml found. Run docstube wizard first.');
      expect(output.lines).toContain('error:config: failed - missing docstube.yml');
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

      await expect(runRefreshCommand({ workspaceDir: dir, refresh: deterministicRefresh }, output)).resolves.toEqual({
        exitCode: 0
      });
      expect(lines).toContain('info:Loaded manifest with 2 pages.');
      expect(lines).toContain('info:regenerated: guides/install (nav-page-missing)');
      expect(lines).toContain('info:regenerated: overview (nav-page-missing)');
      expect(lines).toContain('info:Refreshed 8 vendored asset files.');
    });
  });

  it('reports status and handles a clean deterministic refinement plan', async () => {
    await withWorkspace(async (dir) => {
      await expect(
        runGenerateCommand({ workspaceDir: dir, generate: deterministicGenerate }, captureOutput().output)
      ).resolves.toEqual({ exitCode: 0 });

      const status = captureOutput();
      await expect(runStatusCommand({ workspaceDir: dir }, status.output)).resolves.toEqual({ exitCode: 0 });
      expect(status.lines).toContain('info:Config: valid (docstube.yml)');
      expect(status.lines).toContain('info:Pages: passed:2');
      expect(status.lines).toContain('info:Stale pages: 0');

      const refine = captureOutput();
      await expect(runRefineCommand({ workspaceDir: dir }, refine.output)).resolves.toEqual({ exitCode: 0 });
      expect(refine.lines).toContain('info:Ranked 2 refinement candidates.');
      expect(refine.lines).toContain('info:No pages require refinement.');
    });
  });

  it('checks available tool upgrades without mutating installs', async () => {
    await withWorkspace(async (dir) => {
      const { lines, output } = captureOutput();
      await expect(
        runUpgradeCommand(
          {
            check: true,
            currentVersion: '0.0.2',
            detection: { executablePath: 'docstube', source: 'source-checkout' },
            targetVersion: '0.0.3',
            workspaceDir: dir
          },
          output
        )
      ).resolves.toEqual({ exitCode: 0 });

      expect(lines).toEqual([
        'info:Current docstube version: 0.0.2',
        'info:Latest docstube version: 0.0.3',
        'info:An upgrade is available.'
      ]);
    });
  });

  it('does not hit the registry when a source checkout explains its upgrade path', async () => {
    await withWorkspace(async (dir) => {
      const { lines, output } = captureOutput();
      await expect(
        runUpgradeCommand(
          {
            detection: { executablePath: 'apps/cli/src/cli.ts', source: 'source-checkout' },
            fetchLatestVersion: async () => {
              throw new Error('registry should not be queried');
            },
            workspaceDir: dir
          },
          output
        )
      ).resolves.toEqual({ exitCode: 0 });

      expect(lines).toContain('info:This docstube is running from a source checkout.');
      expect(lines).toContain('info:Upgrade with: git pull && pnpm install');
    });
  });

  it('runs the detected local package-manager upgrade command', async () => {
    await withWorkspace(async (dir) => {
      const commands: string[] = [];
      const { lines, output } = captureOutput();
      await expect(
        runUpgradeCommand(
          {
            currentVersion: '0.0.2',
            detection: {
              executablePath: join(dir, 'node_modules', '.bin', 'docstube'),
              packageInstallScope: 'local',
              packageManager: 'pnpm',
              packageRoot: join(dir, 'node_modules', 'docstube'),
              source: 'node-package'
            },
            runProcess: async (command, args, options) => {
              commands.push(`${command} ${args.join(' ')} ${options?.cwd ?? ''}`.trim());
              return { exitCode: 0, stdout: '', stderr: '' };
            },
            targetVersion: '0.0.3',
            workspaceDir: dir
          },
          output
        )
      ).resolves.toEqual({ exitCode: 0 });

      expect(commands).toEqual([`pnpm add -D docstube@0.0.3 ${dir}`]);
      expect(lines).toContain('info:Running pnpm add -D docstube@0.0.3.');
      expect(lines).toContain('info:Upgraded docstube to 0.0.3.');
    });
  });

  it('prints an ephemeral package-manager upgrade hint instead of mutating cache', async () => {
    await withWorkspace(async (dir) => {
      const { lines, output } = captureOutput();
      await expect(
        runUpgradeCommand(
          {
            detection: {
              executablePath: join(dir, '_npx', 'docstube'),
              packageManager: 'npm',
              source: 'ephemeral'
            },
            fetchLatestVersion: async () => {
              throw new Error('registry should not be queried');
            },
            workspaceDir: dir
          },
          output
        )
      ).resolves.toEqual({ exitCode: 0 });

      expect(lines).toContain('info:This docstube is running from an ephemeral package-manager cache.');
      expect(lines).toContain('info:Use npx docstube@latest for the latest ephemeral run.');
    });
  });

  it('replaces a standalone executable from a verified release asset', async () => {
    await withWorkspace(async (dir) => {
      const executablePath = join(dir, 'docstube');
      await writeFile(executablePath, 'old', 'utf8');
      const archive = Buffer.from('fake archive');
      const { lines, output } = captureOutput();

      await expect(
        runUpgradeCommand(
          {
            arch: 'x64',
            currentVersion: '0.0.2',
            detection: { executablePath, source: 'standalone-binary' },
            download: async (url) =>
              url.endsWith('.sha256') ? sha256FileText(archive, 'docstube-v0.0.3-linux-x64.tar.gz') : archive,
            platform: 'linux',
            runProcess: async (_command, args) => {
              const outDir = String(args.at(-1));
              await writeFile(join(outDir, 'docstube'), 'new', 'utf8');
              return { exitCode: 0, stdout: '', stderr: '' };
            },
            targetVersion: '0.0.3',
            workspaceDir: dir
          },
          output
        )
      ).resolves.toEqual({ exitCode: 0 });

      await expect(readFile(executablePath, 'utf8')).resolves.toBe('new');
      expect(lines).toContain('info:Upgraded standalone docstube to 0.0.3.');
    });
  });

  it('keeps runtime telemetry opt-out and never sends forbidden runtime data', async () => {
    await withWorkspace(async (dir) => {
      await expect(readRuntimeTelemetryEnabled(dir)).resolves.toBe(true);
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

  it('discloses runtime telemetry once before the first CLI telemetry run', async () => {
    await withWorkspace(async (dir) => {
      const disclosures: string[] = [];

      await expect(
        discloseRuntimeTelemetryOnFirstRun({
          workspaceDir: dir,
          now: () => new Date('2026-01-01T00:00:00.000Z'),
          onDisclosure: (message) => disclosures.push(message)
        })
      ).resolves.toEqual({ disclosed: true });
      await expect(readFile(join(dir, '.docstube', 'telemetry.json'), 'utf8')).resolves.toContain(
        '"disclosedAt": "2026-01-01T00:00:00.000Z"'
      );
      expect(disclosures[0]).toContain('never sends source code');

      await expect(
        discloseRuntimeTelemetryOnFirstRun({
          workspaceDir: dir,
          onDisclosure: (message) => disclosures.push(message)
        })
      ).resolves.toEqual({ disclosed: false });
      expect(disclosures).toHaveLength(1);

      const optedOutDir = await mkdtemp(join(tmpdir(), 'docstube-cli-optout-'));
      try {
        await expect(
          discloseRuntimeTelemetryOnFirstRun({
            workspaceDir: optedOutDir,
            env: { DOCSTUBE_TELEMETRY: 'false' },
            onDisclosure: (message) => disclosures.push(message)
          })
        ).resolves.toEqual({ disclosed: false });
        await expect(pathExists(join(optedOutDir, '.docstube', 'telemetry.json'))).resolves.toBe(false);
      } finally {
        await rm(optedOutDir, { recursive: true, force: true });
      }
    });
  });

  it('records CLI command execution telemetry without paths, prompts, source, or secrets', async () => {
    await withWorkspace(async (dir) => {
      const sent: RuntimeTelemetryEvent[] = [];
      let time = 0;

      await expect(
        runCliCommandWithTelemetry({
          command: 'generate',
          workspaceDir: dir,
          now: () => {
            time += 15;
            return time;
          },
          run: () => ({ exitCode: 0 }),
          transport: (payload) => {
            sent.push(payload);
          }
        })
      ).resolves.toEqual({ exitCode: 0 });

      expect(sent.map((event) => event.status)).toEqual(['started', 'succeeded']);
      expect(sent[1]).toMatchObject({ command: 'generate', durationMs: 15, status: 'succeeded' });
      const serialized = JSON.stringify(sent);
      for (const forbidden of [dir, 'docstube.yml', 'sk-', 'prompt', 'path', 'source', 'transcript', 'secret']) {
        expect(serialized).not.toContain(forbidden);
      }

      sent.length = 0;
      await expect(
        runCliCommandWithTelemetry({
          command: 'generate',
          env: { DOCSTUBE_TELEMETRY: 'false' },
          workspaceDir: dir,
          run: () => ({ exitCode: 0 }),
          transport: (payload) => {
            sent.push(payload);
          }
        })
      ).resolves.toEqual({ exitCode: 0 });
      expect(sent).toEqual([]);
    });
  });
});
