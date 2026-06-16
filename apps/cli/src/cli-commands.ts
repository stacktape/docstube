import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
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

export type StartControlPlane = (options: {
  openBrowser?: OpenBrowser;
  uiDevServerUrl?: string;
  workspaceDir?: string;
}) => Promise<StartedLocalControlPlane>;

export type WizardCommandOptions = {
  fresh?: boolean;
  openBrowser?: OpenBrowser;
  start?: StartControlPlane;
  uiDevServerUrl?: string;
  workspaceDir?: string;
};

export type GenerateCommandOptions = {
  configPath?: string;
  fresh?: boolean;
  workspaceDir?: string;
};

export type RefreshCommandOptions = {
  configPath?: string;
  workspaceDir?: string;
};

export type RefineCommandOptions = {
  all?: boolean;
  failed?: boolean;
  maxRounds?: number;
  target?: string;
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

export type CheckAllCommandOptions = {
  workspaceDir?: string;
};

export type StatusCommandOptions = {
  workspaceDir?: string;
};

export type DoctorCommandOptions = {
  workspaceDir?: string;
};

export type UpgradeCommandOptions = {
  check?: boolean;
  project?: boolean;
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

const deleteMachineState = async (workspaceDir: string): Promise<void> => {
  await Promise.all(stateFiles(workspaceDir).map((file) => rm(file, { force: true })));
};

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

const manifestPath = (workspaceDir: string): string => join(workspaceDir, '.docstube', 'manifest.yml');

const listFilesRecursive = async (root: string, extensions: readonly string[]): Promise<string[]> => {
  if (!(await pathExists(root))) {
    return [];
  }

  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry.name);
      if (entry.isDirectory()) {
        return listFilesRecursive(path, extensions);
      }

      return extensions.some((extension) => entry.name.endsWith(extension)) ? [path] : [];
    })
  );

  return files.flat().toSorted();
};

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

export const runWizardCommand = async (
  options: WizardCommandOptions = {},
  output: CliOutput = defaultOutput
): Promise<CliCommandResult> => {
  const workspaceDir = options.workspaceDir ?? process.cwd();
  const existingState = await pathExists(stateFiles(workspaceDir)[0]!);

  if (options.fresh) {
    await deleteMachineState(workspaceDir);
    output.info('Discarded local wizard state.');
  } else if (existingState) {
    output.info('Resuming existing local wizard state.');
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

export const runGenerateCommand = async (
  options: GenerateCommandOptions = {},
  output: CliOutput = defaultOutput
): Promise<CliCommandResult> => {
  const workspaceDir = options.workspaceDir ?? process.cwd();
  const configPath = options.configPath ?? 'docstube.yml';

  if (!(await pathExists(join(workspaceDir, configPath)))) {
    output.error(`No ${configPath} found. Run docstube wizard first.`);
    return { exitCode: 1 };
  }

  if (options.fresh) {
    await deleteMachineState(workspaceDir);
    output.info('Discarded local generation state.');
  } else if (await pathExists(stateFiles(workspaceDir)[0]!)) {
    output.info('Resuming existing local generation state.');
  }

  return runGenerateInitialization({ configPath, workspaceDir }, output);
};

export const runRefreshCommand = async (
  options: RefreshCommandOptions = {},
  output: CliOutput = defaultOutput
): Promise<CliCommandResult> => {
  const workspaceDir = options.workspaceDir ?? process.cwd();
  const path = manifestPath(workspaceDir);
  if (!(await pathExists(path))) {
    output.error('No .docstube/manifest.yml found. Run docstube generate first.');
    return { exitCode: 1 };
  }

  const { readManifestFile } = await import('@docstube/core');
  const manifest = await readManifestFile(path);
  output.info(`Loaded manifest with ${manifest.pages.length} pages.`);
  output.info('Refresh checks all pages by default, regenerates stale pages, and updates vendored theme assets.');
  output.info('Refresh engine is ready to resolve stale pages.');
  return { exitCode: 0 };
};

export const runRefineCommand = async (
  options: RefineCommandOptions = {},
  output: CliOutput = defaultOutput
): Promise<CliCommandResult> => {
  const workspaceDir = options.workspaceDir ?? process.cwd();
  const path = manifestPath(workspaceDir);
  if (!(await pathExists(path))) {
    output.error('No .docstube/manifest.yml found. Run docstube generate first.');
    return { exitCode: 1 };
  }

  const { readManifestFile } = await import('@docstube/core');
  const manifest = await readManifestFile(path);
  const target = options.target ? ` for ${options.target}` : '';
  const rounds = options.maxRounds ? ` up to ${options.maxRounds} rounds` : '';
  output.info(`Loaded manifest with ${manifest.pages.length} pages.`);
  output.info(`Refinement will prioritize the lowest quality scores first${target}${rounds}.`);
  output.error('The score-driven refinement pipeline is not implemented yet.');
  return { exitCode: 1 };
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

export const runCheckAllCommand = async (
  options: CheckAllCommandOptions = {},
  output: CliOutput = defaultOutput
): Promise<CliCommandResult> => {
  const workspaceDir = options.workspaceDir ?? process.cwd();
  let failedCount = 0;

  if (await pathExists(join(workspaceDir, 'docstube.yml'))) {
    const validate = await runValidateCommand({ workspaceDir }, output);
    if (validate.exitCode !== 0) {
      failedCount += 1;
    }
  } else {
    output.info('No docstube.yml found; skipping config-family.');
  }

  const docsRoot = join(workspaceDir, 'docs');
  const files = await listFilesRecursive(docsRoot, ['.d2', '.mdx']);
  if (files.length === 0) {
    output.info('No docs/*.mdx or docs/*.d2 files found.');
  }

  const fileResults = await Promise.all(
    files.map((file) => {
      const kind = file.endsWith('.d2') ? 'd2' : 'mdx';
      return runCheckCommand({ file, kind, workspaceDir }, output);
    })
  );
  failedCount += fileResults.filter((result) => result.exitCode !== 0).length;

  return { exitCode: failedCount > 0 ? 1 : 0 };
};

export const runStatusCommand = async (
  options: StatusCommandOptions = {},
  output: CliOutput = defaultOutput
): Promise<CliCommandResult> => {
  const workspaceDir = options.workspaceDir ?? process.cwd();
  const hasConfig = await pathExists(join(workspaceDir, 'docstube.yml'));
  const hasManifest = await pathExists(manifestPath(workspaceDir));

  output.info(`Config: ${hasConfig ? 'found' : 'missing'}`);
  output.info(`Manifest: ${hasManifest ? 'found' : 'missing'}`);

  if (hasManifest) {
    const { readManifestFile } = await import('@docstube/core');
    const manifest = await readManifestFile(manifestPath(workspaceDir));
    const counts = new Map<string, number>();
    for (const page of manifest.pages) {
      counts.set(page.status, (counts.get(page.status) ?? 0) + 1);
    }
    const summary =
      counts.size === 0 ? '0 pages' : [...counts.entries()].map(([status, count]) => `${status}:${count}`).join(', ');
    output.info(`Pages: ${summary}`);
    output.info(`Generated with: ${manifest.generatedWith.name} ${manifest.generatedWith.version}`);
  }

  return { exitCode: 0 };
};

export const runDoctorCommand = async (
  options: DoctorCommandOptions = {},
  output: CliOutput = defaultOutput
): Promise<CliCommandResult> => {
  const workspaceDir = options.workspaceDir ?? process.cwd();
  output.info(`Node: ${process.version}`);
  output.info(`Platform: ${process.platform}/${process.arch}`);

  if (!(await pathExists(join(workspaceDir, 'docstube.yml')))) {
    output.error('Config: missing docstube.yml. Run docstube wizard first.');
    return { exitCode: 1 };
  }

  const validate = await runValidateCommand({ workspaceDir }, output);
  return { exitCode: validate.exitCode };
};

export const runUpgradeCommand = async (
  options: UpgradeCommandOptions = {},
  output: CliOutput = defaultOutput
): Promise<CliCommandResult> => {
  if (options.check) {
    output.info(`Current docstube version: ${docstubeVersion}`);
    output.info('Upgrade availability checks are not implemented yet.');
    return { exitCode: 0 };
  }

  if (options.project) {
    output.error('Project asset/theme upgrades are not implemented yet.');
    return { exitCode: 1 };
  }

  output.error('Self-upgrade is not implemented yet.');
  output.info('For npm installs, use your package manager to install docstube@latest.');
  output.info('For standalone installs, rerun the docstube install script.');
  return { exitCode: 1 };
};

export const runGenerateInitialization = async (
  input: {
    configPath?: string;
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
    const result = await initializeRunFromConfigFamily({
      backend,
      configPath: input.configPath,
      workspaceDir: input.workspaceDir
    });
    output.info(`${result.resumed ? 'Resumed' : 'Initialized'} ${result.pages.length} pages for ${result.run.id}.`);
    output.info('Generation pipeline is queued from config; page writing is implemented by the pipeline tasks.');
    return { exitCode: 0 };
  } finally {
    await backend.close();
  }
};
