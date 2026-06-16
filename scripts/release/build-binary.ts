import { createHash } from 'node:crypto';
import { chmod, cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

type ReleasePlatform = 'linux-arm64' | 'linux-x64' | 'macos-arm64' | 'macos-x64' | 'windows-x64';

const platformTargets: Record<ReleasePlatform, { archive: 'tar.gz' | 'zip'; executable: string; pkgTarget: string }> = {
  'linux-arm64': { archive: 'tar.gz', executable: 'docstube', pkgTarget: 'node24-linux-arm64' },
  'linux-x64': { archive: 'tar.gz', executable: 'docstube', pkgTarget: 'node24-linux-x64' },
  'macos-arm64': { archive: 'tar.gz', executable: 'docstube', pkgTarget: 'node24-macos-arm64' },
  'macos-x64': { archive: 'tar.gz', executable: 'docstube', pkgTarget: 'node24-macos-x64' },
  'windows-x64': { archive: 'zip', executable: 'docstube.exe', pkgTarget: 'node24-win-x64' }
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const getValue = (name: string) => {
    const index = args.indexOf(`--${name}`);
    return index === -1 ? undefined : args[index + 1];
  };

  const platform = getValue('platform') as ReleasePlatform | undefined;
  const version = getValue('version');
  const outDir = getValue('out-dir') || 'dist-release';

  if (!version) {
    throw new Error('Missing --version.');
  }
  if (!platform || !platformTargets[platform]) {
    throw new Error(`Missing or unsupported --platform. Supported: ${Object.keys(platformTargets).join(', ')}`);
  }

  return { outDir, platform, version };
};

const run = async (command: string, args: string[], options: { cwd?: string } = {}) => {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, shell: process.platform === 'win32', stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} failed with exit code ${code}.`));
    });
  });
};

const createTarGz = async ({ archivePath, cwd }: { archivePath: string; cwd: string }) => {
  const tar = await import('tar');
  await tar.c({ cwd, file: archivePath, gzip: true, portable: true }, ['.']);
};

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

const crc32 = (buffer: Buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const uint16 = (value: number) => {
  const buffer = Buffer.allocUnsafe(2);
  buffer.writeUInt16LE(value, 0);
  return buffer;
};

const uint32 = (value: number) => {
  const buffer = Buffer.allocUnsafe(4);
  buffer.writeUInt32LE(value, 0);
  return buffer;
};

const createZip = async ({ archivePath, cwd }: { archivePath: string; cwd: string }) => {
  const fileNames = (await readdir(cwd, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .toSorted();
  const files = await Promise.all(
    fileNames.map(async (fileName) => ({
      content: await readFile(join(cwd, fileName)),
      fileName
    }))
  );
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const { content, fileName } of files) {
    const nameBuffer = Buffer.from(fileName);
    const checksum = crc32(content);
    const localHeader = Buffer.concat([
      uint32(0x04034b50),
      uint16(20),
      uint16(0),
      uint16(0),
      uint16(0),
      uint16(0),
      uint32(checksum),
      uint32(content.length),
      uint32(content.length),
      uint16(nameBuffer.length),
      uint16(0),
      nameBuffer
    ]);
    const centralHeader = Buffer.concat([
      uint32(0x02014b50),
      uint16(20),
      uint16(20),
      uint16(0),
      uint16(0),
      uint16(0),
      uint16(0),
      uint32(checksum),
      uint32(content.length),
      uint32(content.length),
      uint16(nameBuffer.length),
      uint16(0),
      uint16(0),
      uint16(0),
      uint16(0),
      uint32(0),
      uint32(offset),
      nameBuffer
    ]);

    localParts.push(localHeader, content);
    centralParts.push(centralHeader);
    offset += localHeader.length + content.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const endOfCentralDirectory = Buffer.concat([
    uint32(0x06054b50),
    uint16(0),
    uint16(0),
    uint16(fileNames.length),
    uint16(fileNames.length),
    uint32(centralDirectory.length),
    uint32(offset),
    uint16(0)
  ]);

  await writeFile(archivePath, Buffer.concat([...localParts, centralDirectory, endOfCentralDirectory]));
};

const writeSha256 = async (filePath: string) => {
  const hash = createHash('sha256');
  hash.update(await readFile(filePath));
  await writeFile(`${filePath}.sha256`, `${hash.digest('hex')}  ${basename(filePath)}\n`);
};

const main = async () => {
  const { outDir, platform, version } = parseArgs();
  const target = platformTargets[platform];
  const releaseRoot = resolve(outDir);
  const stagingDir = join(releaseRoot, `docstube-v${version}-${platform}`);
  const executablePath = join(stagingDir, target.executable);
  const archivePath = join(releaseRoot, `docstube-v${version}-${platform}.${target.archive}`);

  await run('pnpm', ['run', 'build:cli']);
  await rm(stagingDir, { force: true, recursive: true });
  await mkdir(stagingDir, { recursive: true });

  await run('pnpm', [
    '--filter',
    'docstube',
    'exec',
    'pkg',
    resolve('apps/cli/dist/cli.mjs'),
    '--targets',
    target.pkgTarget,
    '--output',
    executablePath,
    '--compress',
    'Brotli',
    '--fallback-to-source'
  ]);

  if (target.archive === 'tar.gz') {
    await chmod(executablePath, 0o755);
  }

  await cp(resolve('apps/cli/local-ui'), join(stagingDir, 'local-ui'), { recursive: true });
  await writeFile(join(stagingDir, 'release-data.json'), `${JSON.stringify({ platform, version }, null, 2)}\n`);
  await rm(archivePath, { force: true });

  if (target.archive === 'zip') {
    await createZip({ archivePath, cwd: stagingDir });
  } else {
    await createTarGz({ archivePath, cwd: stagingDir });
  }

  await writeSha256(archivePath);

  const stats = await stat(archivePath);
  console.info(`Built ${archivePath} (${stats.size} bytes).`);
};

await main();
