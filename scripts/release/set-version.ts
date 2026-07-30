import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const workspaceRoots = ['apps', 'packages'];

const parseArgs = () => {
  const args = process.argv.slice(2);
  const versionIndex = args.indexOf('--version');
  const version = versionIndex === -1 ? undefined : args[versionIndex + 1];

  if (!version) {
    throw new Error('Missing --version.');
  }
  if (!/^\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/.test(version)) {
    throw new Error(`Invalid release version: ${version}`);
  }

  return { version };
};

const updatePackageJson = async (packageJsonPath: string, version: string) => {
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as { version?: string };
  packageJson.version = version;
  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
};

const updateSourceVersionFile = async (path: string, replacements: readonly [RegExp, string][]) => {
  let content = await readFile(path, 'utf8');
  for (const [pattern, replacement] of replacements) {
    content = content.replace(pattern, replacement);
  }
  await writeFile(path, content);
};

const updateSourceVersion = async (version: string) => {
  // Exactly two source constants hold the version: the kernel's and the CLI's. `core.ts` only
  // re-exports `version.ts`, so the old pattern aimed at `core.ts` silently matched nothing.
  await updateSourceVersionFile(resolve('packages/core/src/version.ts'), [
    [/export const docstubeVersion = '[^']+';/, `export const docstubeVersion = '${version}';`]
  ]);
  await updateSourceVersionFile(resolve('apps/cli/src/cli-version.ts'), [
    [/export const docstubeVersion = '[^']+';/, `export const docstubeVersion = '${version}';`]
  ]);
  // The Action pins the exact docstube version it runs (never @latest); both the action.yml
  // input default and the TS fallback constant track the release version.
  await updateSourceVersionFile(resolve('apps/github-action/action.yml'), [
    [/default: docstube@\S+/, `default: docstube@${version}`]
  ]);
  await updateSourceVersionFile(resolve('apps/github-action/src/github-action.ts'), [
    [/const defaultDocstubePackage = 'docstube@[^']+';/, `const defaultDocstubePackage = 'docstube@${version}';`]
  ]);
};

const main = async () => {
  const { version } = parseArgs();
  const workspacePackageJsonPaths = await Promise.all(
    workspaceRoots.map(async (root) => {
      const rootPath = resolve(root);
      const entries = await readdir(rootPath, { withFileTypes: true });
      return entries.filter((entry) => entry.isDirectory()).map((entry) => join(rootPath, entry.name, 'package.json'));
    })
  );

  await Promise.all([
    updatePackageJson(resolve('package.json'), version),
    updateSourceVersion(version),
    ...workspacePackageJsonPaths.flat().map((packageJsonPath) => updatePackageJson(packageJsonPath, version))
  ]);

  console.info(`Set workspace versions to ${version}.`);
};

await main();
