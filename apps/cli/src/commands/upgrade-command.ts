import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { chmod, copyFile, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { docstubeVersion } from '@docstube/core';
import { defaultOutput } from '../cli-output.ts';
import type { CliCommandResult, CliOutput } from '../cli-output.ts';
import { pathExists } from '../workspace-paths.ts';

export type UpgradeInstallSource = 'node-package' | 'source-checkout' | 'standalone-binary' | 'ephemeral' | 'unknown';

export type UpgradePackageManager = 'bun' | 'npm' | 'pnpm' | 'yarn';

export type UpgradeDetection = {
  executablePath: string;
  packageInstallScope?: 'global' | 'local' | 'unknown';
  packageRoot?: string;
  packageManager?: UpgradePackageManager;
  source: UpgradeInstallSource;
};

export type UpgradeRunProcess = (
  command: string,
  args: readonly string[],
  options?: { cwd?: string; env?: Record<string, string | undefined> }
) => Promise<{ exitCode: number; stderr: string; stdout: string }>;

export type UpgradeCommandOptions = {
  arch?: NodeJS.Architecture;
  check?: boolean;
  currentVersion?: string;
  detection?: UpgradeDetection;
  download?: (url: string) => Promise<Buffer>;
  fetchLatestVersion?: () => Promise<string>;
  platform?: NodeJS.Platform;
  runProcess?: UpgradeRunProcess;
  targetVersion?: string;
  workspaceDir?: string;
};

type ReleasePlatform = 'linux-arm64' | 'linux-x64' | 'macos-arm64' | 'macos-x64' | 'windows-x64';

const runProcess: UpgradeRunProcess = async (command, args, options = {}) =>
  new Promise((resolveProcess) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      shell: process.platform === 'win32',
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      resolveProcess({ exitCode: 1, stdout, stderr: error.message });
    });
    child.on('exit', (code) => {
      resolveProcess({ exitCode: code ?? 1, stdout, stderr });
    });
  });

const packageManagerFromLockfile = async (workspaceDir: string): Promise<UpgradePackageManager | undefined> => {
  if (await pathExists(join(workspaceDir, 'pnpm-lock.yaml'))) {
    return 'pnpm';
  }
  if ((await pathExists(join(workspaceDir, 'bun.lock'))) || (await pathExists(join(workspaceDir, 'bun.lockb')))) {
    return 'bun';
  }
  if (await pathExists(join(workspaceDir, 'yarn.lock'))) {
    return 'yarn';
  }
  if (
    (await pathExists(join(workspaceDir, 'package-lock.json'))) ||
    (await pathExists(join(workspaceDir, 'npm-shrinkwrap.json')))
  ) {
    return 'npm';
  }
  return undefined;
};

const packageManagerFromUserAgent = (userAgent?: string): UpgradePackageManager | undefined => {
  if (!userAgent) {
    return undefined;
  }
  if (userAgent.startsWith('pnpm/')) {
    return 'pnpm';
  }
  if (userAgent.startsWith('bun/')) {
    return 'bun';
  }
  if (userAgent.startsWith('yarn/')) {
    return 'yarn';
  }
  if (userAgent.startsWith('npm/')) {
    return 'npm';
  }
  return undefined;
};

const findPackageRoot = (fromPath: string): string | undefined => {
  let current = dirname(fromPath);
  while (true) {
    const packageJson = join(current, 'package.json');
    if (existsSync(packageJson)) {
      try {
        const parsed = JSON.parse(readFileSync(packageJson, 'utf8')) as { name?: unknown };
        if (parsed.name === 'docstube') {
          return current;
        }
      } catch {
        return current;
      }
    }

    const parent = dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
};

const pathInside = (candidate: string, root: string): boolean => {
  const relativePath = relative(resolve(root), resolve(candidate));
  return relativePath === '' || (!relativePath.startsWith('..') && !relativePath.startsWith('/'));
};

const detectGlobalPackageInstall = async (
  packageRoot: string,
  packageManager: UpgradePackageManager | undefined,
  run: UpgradeRunProcess
): Promise<boolean> => {
  const commands: [UpgradePackageManager, string[]][] =
    packageManager === 'pnpm'
      ? [['pnpm', ['root', '-g']]]
      : packageManager === 'yarn'
        ? [['yarn', ['global', 'dir']]]
        : [['npm', ['root', '-g']]];

  const results = await Promise.all(
    commands.map(async ([manager, args]) => {
      const result = await run(manager, args);
      return result.exitCode === 0 && result.stdout.trim().length > 0
        ? pathInside(packageRoot, result.stdout.trim())
        : false;
    })
  );
  return results.some(Boolean);
};

const detectUpgradeInstall = async (input: {
  run: UpgradeRunProcess;
  workspaceDir: string;
}): Promise<UpgradeDetection> => {
  const executablePath = process.execPath;
  const entryPath = process.argv[1] ? resolve(process.argv[1]) : fileURLToPath(import.meta.url);
  const packageManager =
    (await packageManagerFromLockfile(input.workspaceDir)) ??
    packageManagerFromUserAgent(process.env.npm_config_user_agent);

  if ((process as typeof process & { pkg?: unknown }).pkg) {
    return { executablePath, packageManager, source: 'standalone-binary' };
  }

  const normalizedEntryPath = entryPath.replaceAll('\\', '/');
  if (normalizedEntryPath.includes('/_npx/') || normalizedEntryPath.includes('/.pnpm/dlx/')) {
    return { executablePath: entryPath, packageManager, source: 'ephemeral' };
  }

  if (normalizedEntryPath.endsWith('/apps/cli/src/cli.ts')) {
    return { executablePath: entryPath, packageManager, source: 'source-checkout' };
  }

  const packageRoot = findPackageRoot(entryPath);
  if (packageRoot) {
    const packageInstallScope = (await detectGlobalPackageInstall(packageRoot, packageManager, input.run))
      ? 'global'
      : pathInside(packageRoot, input.workspaceDir)
        ? 'local'
        : 'unknown';
    return {
      executablePath: entryPath,
      packageInstallScope,
      packageManager,
      packageRoot,
      source: 'node-package'
    };
  }

  return { executablePath: entryPath, packageManager, source: 'unknown' };
};

const fetchLatestDocstubeVersion = async (): Promise<string> => {
  const response = await fetch('https://registry.npmjs.org/docstube/latest', {
    headers: { accept: 'application/json' }
  });
  if (!response.ok) {
    throw new Error(`npm registry returned HTTP ${response.status}.`);
  }

  const parsed = (await response.json()) as { version?: unknown };
  if (typeof parsed.version !== 'string' || parsed.version.length === 0) {
    throw new Error('npm registry response did not include a version.');
  }
  return parsed.version;
};

const parseSemver = (version: string): [number, number, number] | undefined => {
  const match = /^(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)/u.exec(version);
  if (!match?.groups) {
    return undefined;
  }
  return [Number(match.groups.major), Number(match.groups.minor), Number(match.groups.patch)];
};

const compareSemver = (left: string, right: string): number => {
  const leftParts = parseSemver(left);
  const rightParts = parseSemver(right);
  if (!leftParts || !rightParts) {
    return left.localeCompare(right);
  }

  for (let index = 0; index < leftParts.length; index += 1) {
    const difference = leftParts[index]! - rightParts[index]!;
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
};

const releasePlatformFor = (platform: NodeJS.Platform, arch: NodeJS.Architecture): ReleasePlatform | undefined => {
  if (platform === 'linux' && arch === 'x64') {
    return 'linux-x64';
  }
  if (platform === 'linux' && arch === 'arm64') {
    return 'linux-arm64';
  }
  if (platform === 'darwin' && arch === 'x64') {
    return 'macos-x64';
  }
  if (platform === 'darwin' && arch === 'arm64') {
    return 'macos-arm64';
  }
  if (platform === 'win32' && arch === 'x64') {
    return 'windows-x64';
  }
  return undefined;
};

const defaultDownload = async (url: string): Promise<Buffer> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed with HTTP ${response.status}: ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
};

const verifySha256 = (content: Buffer, checksumFile: Buffer, archiveName: string): void => {
  const expected = checksumFile.toString('utf8').trim().split(/\s+/u)[0];
  if (!expected) {
    throw new Error(`Checksum file for ${archiveName} is empty.`);
  }

  const actual = createHash('sha256').update(content).digest('hex');
  if (actual !== expected) {
    throw new Error(`Checksum mismatch for ${archiveName}.`);
  }
};

const uint16 = (content: Buffer, offset: number): number => content.readUInt16LE(offset);

const uint32 = (content: Buffer, offset: number): number => content.readUInt32LE(offset);

const extractStoredZipEntry = (archive: Buffer, fileName: string): Buffer => {
  let offset = 0;
  while (offset + 30 <= archive.length) {
    if (uint32(archive, offset) !== 0x04034b50) {
      break;
    }

    const method = uint16(archive, offset + 8);
    const compressedSize = uint32(archive, offset + 18);
    const fileNameLength = uint16(archive, offset + 26);
    const extraLength = uint16(archive, offset + 28);
    const nameStart = offset + 30;
    const nameEnd = nameStart + fileNameLength;
    const dataStart = nameEnd + extraLength;
    const dataEnd = dataStart + compressedSize;
    const name = archive.subarray(nameStart, nameEnd).toString('utf8');

    if (name === fileName) {
      if (method !== 0) {
        throw new Error(`Unsupported compressed zip entry for ${fileName}.`);
      }
      return archive.subarray(dataStart, dataEnd);
    }

    offset = dataEnd;
  }

  throw new Error(`Release archive does not contain ${fileName}.`);
};

const downloadReleaseExecutable = async (input: {
  arch: NodeJS.Architecture;
  download: (url: string) => Promise<Buffer>;
  platform: NodeJS.Platform;
  run: UpgradeRunProcess;
  version: string;
}): Promise<{ executableName: string; executablePath: string; tempDir: string }> => {
  const releasePlatform = releasePlatformFor(input.platform, input.arch);
  if (!releasePlatform) {
    throw new Error(`Standalone upgrade is not available for ${input.platform}/${input.arch}.`);
  }

  const archiveExtension = releasePlatform === 'windows-x64' ? 'zip' : 'tar.gz';
  const executableName = releasePlatform === 'windows-x64' ? 'docstube.exe' : 'docstube';
  const archiveName = `docstube-v${input.version}-${releasePlatform}.${archiveExtension}`;
  const baseUrl = `https://github.com/stacktape/docstube/releases/download/v${input.version}`;
  const [archive, checksum] = await Promise.all([
    input.download(`${baseUrl}/${archiveName}`),
    input.download(`${baseUrl}/${archiveName}.sha256`)
  ]);
  verifySha256(archive, checksum, archiveName);

  const tempDir = await mkdtemp(join(tmpdir(), 'docstube-upgrade-'));
  const archivePath = join(tempDir, archiveName);
  const executablePath = join(tempDir, executableName);
  await writeFile(archivePath, archive);

  if (archiveExtension === 'zip') {
    await writeFile(executablePath, extractStoredZipEntry(archive, executableName));
  } else {
    const extract = await input.run('tar', ['-xzf', archivePath, '-C', tempDir]);
    if (extract.exitCode !== 0) {
      throw new Error(extract.stderr || 'Failed to extract release archive.');
    }
  }

  await chmod(executablePath, 0o755);
  return { executableName, executablePath, tempDir };
};

const shellQuote = (value: string): string =>
  process.platform === 'win32' ? `"${value}"` : `'${value.replaceAll("'", "'\\''")}'`;

const localUpgradeArgs = (packageManager: UpgradePackageManager, version: string): readonly string[] => {
  if (packageManager === 'pnpm') {
    return ['add', '-D', `docstube@${version}`];
  }
  if (packageManager === 'yarn') {
    return ['add', '--dev', `docstube@${version}`];
  }
  if (packageManager === 'bun') {
    return ['add', '--development', `docstube@${version}`];
  }
  return ['install', '--save-dev', `docstube@${version}`];
};

const globalUpgradeArgs = (packageManager: UpgradePackageManager, version: string): readonly string[] => {
  if (packageManager === 'pnpm') {
    return ['add', '-g', `docstube@${version}`];
  }
  if (packageManager === 'yarn') {
    return ['global', 'add', `docstube@${version}`];
  }
  if (packageManager === 'bun') {
    return ['add', '-g', `docstube@${version}`];
  }
  return ['install', '-g', `docstube@${version}`];
};

const commandText = (command: string, args: readonly string[]): string =>
  [command, ...args].map((part) => (/\s/u.test(part) ? shellQuote(part) : part)).join(' ');

const psSingleQuote = (value: string): string => `'${value.replaceAll("'", "''")}'`;

const replaceStandaloneExecutable = async (input: {
  detection: UpgradeDetection;
  executablePath: string;
  output: CliOutput;
  platform: NodeJS.Platform;
  tempDir: string;
  version: string;
}): Promise<CliCommandResult> => {
  if (input.platform === 'win32') {
    const stagedExecutable = join(input.tempDir, 'docstube-new.exe');
    await copyFile(input.executablePath, stagedExecutable);
    const scriptPath = join(input.tempDir, 'finish-docstube-upgrade.ps1');
    await writeFile(
      scriptPath,
      [
        '$ErrorActionPreference = "Stop"',
        `Wait-Process -Id ${process.pid} -ErrorAction SilentlyContinue`,
        `Move-Item -LiteralPath ${psSingleQuote(stagedExecutable)} -Destination ${psSingleQuote(input.detection.executablePath)} -Force`,
        `Remove-Item -LiteralPath ${psSingleQuote(input.tempDir)} -Recurse -Force -ErrorAction SilentlyContinue`
      ].join('\n'),
      'utf8'
    );

    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    child.unref();
    input.output.info(
      `docstube ${input.version} downloaded. The Windows executable will be replaced after this process exits.`
    );
    return { exitCode: 0 };
  }

  const executableDir = dirname(input.detection.executablePath);
  const stagedPath = join(executableDir, `.docstube-upgrade-${input.version}`);
  await copyFile(input.executablePath, stagedPath);
  await chmod(stagedPath, 0o755);
  await rename(stagedPath, input.detection.executablePath);
  await rm(input.tempDir, { recursive: true, force: true });
  input.output.info(`Upgraded standalone docstube to ${input.version}.`);
  return { exitCode: 0 };
};

export const runUpgradeCommand = async (
  options: UpgradeCommandOptions = {},
  output: CliOutput = defaultOutput
): Promise<CliCommandResult> => {
  const workspaceDir = options.workspaceDir ?? process.cwd();
  const currentVersion = options.currentVersion ?? docstubeVersion;
  const run = options.runProcess ?? runProcess;
  const detection = options.detection ?? (await detectUpgradeInstall({ run, workspaceDir }));
  const fetchLatestVersion = options.fetchLatestVersion ?? fetchLatestDocstubeVersion;

  if (options.check) {
    const targetVersion = options.targetVersion ?? (await fetchLatestVersion());
    output.info(`Current docstube version: ${currentVersion}`);
    output.info(`Latest docstube version: ${targetVersion}`);
    output.info(
      compareSemver(currentVersion, targetVersion) >= 0 ? 'docstube is up to date.' : 'An upgrade is available.'
    );
    return { exitCode: 0 };
  }

  if (detection.source === 'source-checkout') {
    output.info('This docstube is running from a source checkout.');
    output.info('Upgrade with: git pull && pnpm install');
    return { exitCode: 0 };
  }

  if (detection.source === 'ephemeral') {
    const packageManager = detection.packageManager ?? 'npm';
    const command =
      packageManager === 'pnpm'
        ? 'pnpm dlx docstube@latest'
        : packageManager === 'bun'
          ? 'bunx docstube@latest'
          : packageManager === 'yarn'
            ? 'yarn dlx docstube@latest'
            : 'npx docstube@latest';
    output.info('This docstube is running from an ephemeral package-manager cache.');
    output.info(`Use ${command} for the latest ephemeral run.`);
    return { exitCode: 0 };
  }

  const targetVersion = options.targetVersion ?? (await fetchLatestVersion());
  if (compareSemver(currentVersion, targetVersion) >= 0) {
    output.info(`docstube ${currentVersion} is already up to date.`);
    return { exitCode: 0 };
  }

  if (detection.source === 'standalone-binary') {
    const downloaded = await downloadReleaseExecutable({
      arch: options.arch ?? process.arch,
      download: options.download ?? defaultDownload,
      platform: options.platform ?? process.platform,
      run,
      version: targetVersion
    });
    return replaceStandaloneExecutable({
      detection,
      executablePath: downloaded.executablePath,
      output,
      platform: options.platform ?? process.platform,
      tempDir: downloaded.tempDir,
      version: targetVersion
    });
  }

  if (detection.source === 'node-package') {
    const packageManager = detection.packageManager ?? (await packageManagerFromLockfile(workspaceDir)) ?? 'npm';
    const global = detection.packageInstallScope === 'global';
    const args = global
      ? globalUpgradeArgs(packageManager, targetVersion)
      : localUpgradeArgs(packageManager, targetVersion);

    if (detection.packageInstallScope === 'unknown') {
      output.info('Could not prove whether this docstube package is local or global.');
      output.info(`Run manually: ${commandText(packageManager, args)}`);
      return { exitCode: 0 };
    }

    output.info(`Running ${commandText(packageManager, args)}.`);
    const result = await run(packageManager, args, { cwd: global ? undefined : workspaceDir });
    if (result.exitCode !== 0) {
      output.error(result.stderr || `${packageManager} failed with exit code ${result.exitCode}.`);
      return { exitCode: result.exitCode };
    }
    output.info(`Upgraded docstube to ${targetVersion}.`);
    return { exitCode: 0 };
  }

  output.error('Could not detect how docstube was installed.');
  output.info('Install the latest version with npm/pnpm, or rerun the standalone install script.');
  return { exitCode: 1 };
};
