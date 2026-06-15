import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const parseArgs = () => {
  const args = process.argv.slice(2);
  const getValue = (name: string) => {
    const index = args.indexOf(`--${name}`);
    return index === -1 ? undefined : args[index + 1];
  };
  const version = getValue('version');
  const outDir = getValue('out-dir') || 'dist-release/install-scripts';

  if (!version) {
    throw new Error('Missing --version.');
  }

  return { outDir, version };
};

const main = async () => {
  const { outDir, version } = parseArgs();
  const templateDir = resolve('scripts/install-templates');
  const outputDir = resolve(outDir);
  const entries = await readdir(templateDir);

  await rm(outputDir, { force: true, recursive: true });
  await mkdir(outputDir, { recursive: true });

  await Promise.all(
    entries.map(async (entry) => {
      const content = await readFile(join(templateDir, entry), 'utf8');
      await writeFile(join(outputDir, entry), content.replaceAll('<<DEFAULT_VERSION>>', version));
    })
  );

  console.info(`Prepared install scripts in ${outputDir}.`);
};

await main();
