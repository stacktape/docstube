import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { parse } from 'yaml';
import type { CheckResult } from '@docstube/contracts';
import type { OpenBrowser, StartedLocalControlPlane } from '@docstube/core';

export type CliOutput = {
  error: (message: string) => void;
  info: (message: string) => void;
};

export type CliCommandResult = {
  exitCode: number;
};

export type GenerateCommandOptions = {
  fresh?: boolean;
  initialize?: (input: { workspaceDir: string }) => Promise<CliCommandResult>;
  openBrowser?: OpenBrowser;
  start?: (options: {
    openBrowser?: OpenBrowser;
    uiDevServerUrl?: string;
    workspaceDir?: string;
  }) => Promise<StartedLocalControlPlane>;
  uiDevServerUrl?: string;
  workspaceDir?: string;
  yes?: boolean;
};

export type UpdateCommandOptions = {
  workspaceDir?: string;
};

export type ValidateCommandOptions = {
  configPath?: string;
  workspaceDir?: string;
};

export type CheckCommandOptions = {
  file: string;
  kind: 'config' | 'd2' | 'mdx' | 'snippet';
  workspaceDir?: string;
};

export type TelemetryAction = 'disable' | 'enable' | 'status';

export type TelemetryCommandOptions = {
  action: TelemetryAction;
  workspaceDir?: string;
};

export type RuntimeTelemetryStatus = 'failed' | 'started' | 'succeeded';

export type RuntimeTelemetryEvent = {
  command: string;
  event: 'cli-command';
  surface: 'runtime';
  status: RuntimeTelemetryStatus;
  version: string;
};

export type RuntimeTelemetryTransport = (event: RuntimeTelemetryEvent) => Promise<void> | void;

const docstubeVersion = '0.0.2';

const defaultOutput: CliOutput = {
  info: (message) => console.info(message),
  error: (message) => console.error(message)
};

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const stateFiles = (workspaceDir: string): string[] => [
  join(workspaceDir, '.docstube', 'db.sqlite'),
  join(workspaceDir, '.docstube', 'db.sqlite-shm'),
  join(workspaceDir, '.docstube', 'db.sqlite-wal')
];

const toRelativePath = (workspaceDir: string, file: string): string => {
  const candidate = relative(workspaceDir, file).replaceAll('\\', '/');
  return candidate && !candidate.startsWith('..') && !candidate.startsWith('/') ? candidate : basename(file);
};

const resultFailed = (result: CheckResult): boolean => result.status === 'failed' || result.status === 'errored';

const printCheckResult = (output: CliOutput, result: CheckResult): void => {
  output.info(`${result.checkId}: ${result.status}`);
  if (result.status === 'failed') {
    for (const finding of result.findings) {
      output.error(`${finding.severity}: ${finding.message}`);
    }
  }
  if (result.status === 'errored') {
    output.error(result.error);
  }
  if (result.status === 'skipped') {
    output.info(result.reason);
  }
};

const telemetryPath = (workspaceDir: string): string => join(workspaceDir, '.docstube', 'telemetry.json');

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

export const runGenerateCommand = async (
  options: GenerateCommandOptions = {},
  output: CliOutput = defaultOutput
): Promise<CliCommandResult> => {
  const workspaceDir = options.workspaceDir ?? process.cwd();
  const existingState = await pathExists(stateFiles(workspaceDir)[0]!);

  if (options.fresh) {
    await Promise.all(stateFiles(workspaceDir).map((file) => rm(file, { force: true })));
    output.info('Discarded local generation state.');
  } else if (existingState) {
    output.info('Resuming existing local generation state.');
  }

  if (options.yes) {
    output.info('Zero-question mode enabled.');
    const initialize = options.initialize ?? ((input) => runGenerateYesInitialization(input, output));
    const initialized = await initialize({ workspaceDir });
    if (initialized.exitCode !== 0) {
      return initialized;
    }
  }

  const start = options.start ?? (await import('@docstube/core')).startGenerateSession;
  const started = await start({
    workspaceDir,
    openBrowser: options.openBrowser,
    uiDevServerUrl: options.uiDevServerUrl
  });
  output.info(`Started local control plane: ${started.url}`);
  return { exitCode: 0 };
};

export const runUpdateCommand = async (
  options: UpdateCommandOptions = {},
  output: CliOutput = defaultOutput
): Promise<CliCommandResult> => {
  const workspaceDir = options.workspaceDir ?? process.cwd();
  const manifestPath = join(workspaceDir, '.docstube', 'manifest.yml');
  if (!(await pathExists(manifestPath))) {
    output.error('No .docstube/manifest.yml found. Run docstube generate first.');
    return { exitCode: 1 };
  }

  const { readManifestFile } = await import('@docstube/core');
  const manifest = await readManifestFile(manifestPath);
  output.info(`Loaded manifest with ${manifest.pages.length} pages.`);
  output.info('Incremental update is ready to resolve dirty pages.');
  return { exitCode: 0 };
};

export const runValidateCommand = async (
  options: ValidateCommandOptions = {},
  output: CliOutput = defaultOutput
): Promise<CliCommandResult> => {
  const workspaceDir = options.workspaceDir ?? process.cwd();
  const configPath = options.configPath ?? 'docstube.yml';
  try {
    const configText = await readFile(join(workspaceDir, configPath), 'utf8');
    const configRaw = parse(configText);
    const config = parse(configText) as { ia?: string; glossary?: string };
    const iaPath = typeof config.ia === 'string' ? config.ia : 'ia.yml';
    const glossaryPath = typeof config.glossary === 'string' ? config.glossary : 'glossary.yaml';
    const [iaRaw, glossaryRaw] = await Promise.all([
      readFile(join(workspaceDir, iaPath), 'utf8').then(parse),
      readFile(join(workspaceDir, glossaryPath), 'utf8').then(parse)
    ]);
    const { checkConfigFamily } = await import('@docstube/verifiers');
    const result = checkConfigFamily({ docstubeConfig: configRaw, ia: iaRaw, glossary: glossaryRaw });
    printCheckResult(output, result);
    return { exitCode: resultFailed(result) ? 1 : 0 };
  } catch (error) {
    output.error(error instanceof Error ? error.message : 'Validation failed.');
    return { exitCode: 1 };
  }
};

export const runCheckCommand = async (
  options: CheckCommandOptions,
  output: CliOutput = defaultOutput
): Promise<CliCommandResult> => {
  const workspaceDir = options.workspaceDir ?? process.cwd();
  const source = await readFile(options.file, 'utf8');
  const path = toRelativePath(workspaceDir, options.file);
  const { checkConfigFamily, checkD2, checkMdxCompiles, checkPythonSnippet, checkTypeScriptSnippet } =
    await import('@docstube/verifiers');
  const result =
    options.kind === 'd2'
      ? await checkD2({ path, source })
      : options.kind === 'mdx'
        ? await checkMdxCompiles({ path, body: source })
        : options.kind === 'snippet'
          ? path.endsWith('.py')
            ? await checkPythonSnippet({ path, code: source })
            : checkTypeScriptSnippet({ path, code: source })
          : checkConfigFamily({ docstubeConfig: parse(source) });

  printCheckResult(output, result);
  return { exitCode: resultFailed(result) ? 1 : 0 };
};

export const runTelemetryCommand = async (
  options: TelemetryCommandOptions,
  output: CliOutput = defaultOutput
): Promise<CliCommandResult> => {
  const workspaceDir = options.workspaceDir ?? process.cwd();
  if (options.action === 'enable' || options.action === 'disable') {
    await writeRuntimeTelemetryEnabled(workspaceDir, options.action === 'enable');
  }

  const enabled = await readRuntimeTelemetryEnabled(workspaceDir);
  output.info(`Runtime telemetry is ${enabled ? 'enabled' : 'disabled'}.`);
  output.info('Runtime telemetry sends command name, status, version, and runtime surface only.');
  output.info('It never sends prompts, file contents, config, source code, transcripts, secrets, or paths.');
  return { exitCode: 0 };
};

export const runGenerateYesInitialization = async (
  input: {
    workspaceDir: string;
    dbPath?: string;
  },
  output: CliOutput = defaultOutput
): Promise<CliCommandResult> => {
  const dbPath = input.dbPath ?? join(input.workspaceDir, '.docstube', 'db.sqlite');
  await mkdir(join(input.workspaceDir, '.docstube'), { recursive: true });
  const { createLocalBackend, initializeRunFromConfigFamily, openDocstubeDatabase } = await import('@docstube/core');
  const backend = createLocalBackend(openDocstubeDatabase(dbPath));
  try {
    const result = await initializeRunFromConfigFamily({ backend, workspaceDir: input.workspaceDir });
    output.info(`Initialized ${result.pages.length} pages for ${result.run.id}.`);
    return { exitCode: 0 };
  } finally {
    await backend.close();
  }
};
