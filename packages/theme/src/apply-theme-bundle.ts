import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ThemeBundle, ThemeBundleFile } from './theme-manifest.ts';
import { ThemeError } from './theme-manifest.ts';

// The refresh/theme-switch algorithm (knowledge/design/theming.md): theme-owned files are
// manifest-driven — previously-owned files absent from the new bundle are deleted only while
// unmodified, user-modified files are preserved and reported as conflicts, and content/kernel
// paths are never touched by theme operations.

export type ThemeOwnedFile = { path: string; hash: string };

export type ThemeFilesManifest = {
  theme: string;
  themeVersion: string;
  files: ThemeOwnedFile[];
};

export type ThemeConflict = {
  path: string;
  // 'kept': a user-modified file from the previous theme was preserved instead of deleted.
  // 'skipped': a user-modified owned file was not overwritten with the new bundle content.
  kind: 'kept' | 'skipped';
};

export type ApplyThemeBundleInput = {
  siteRoot: string;
  bundle: ThemeBundle;
  // Location of the .docstube/theme-files.json ownership manifest (read and rewritten).
  previousManifestPath: string;
  // Recorded as themeVersion; the docstube version is fine for v1.
  themeVersion: string;
  // Kernel-generated config files (astro.config.mjs, package.json): always rewritten, tracked in
  // the ownership manifest alongside the theme-owned paths per the ownership table.
  kernelConfigFiles?: Array<{ path: string; content: string }>;
  // Overwrite user-modified owned files instead of reporting conflicts (--force-theme).
  force?: boolean;
};

export type ApplyThemeBundleResult = {
  written: string[];
  deleted: string[];
  conflicts: ThemeConflict[];
};

const hashBytes = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');

const fileBytes = (file: ThemeBundleFile): Buffer =>
  'content' in file ? Buffer.from(file.content, 'utf8') : Buffer.from(file.base64, 'base64');

// Content/kernel-owned namespaces a theme bundle must never write into (theme operations also
// never delete inside them). src/docstube/** is kernel-owned; astro.config.mjs and package.json
// are kernel-generated (passed separately as kernelConfigFiles).
const protectedPrefixes = ['content/', 'mcp/', 'src/pages/', 'src/docstube/', '.docstube/', 'dist/', 'node_modules/'];
const protectedExact = new Set([
  'astro.config.mjs',
  'package.json',
  'src/site-data.mjs',
  'public/llms.txt',
  'public/llms-full.txt',
  'public/sitemap.xml',
  'public/robots.txt'
]);

const isProtectedPath = (path: string): boolean =>
  protectedExact.has(path) ||
  protectedPrefixes.some((prefix) => path.startsWith(prefix)) ||
  // public/**/*.md are the kernel's raw-markdown content mirrors.
  (path.startsWith('public/') && path.endsWith('.md'));

const assertSafeBundlePaths = (bundle: ThemeBundle): void => {
  for (const file of bundle.files) {
    const path = file.path;
    const unsafe =
      path.length === 0 ||
      path.includes('\\') ||
      path.startsWith('/') ||
      /^[A-Za-z]:/.test(path) ||
      path.split('/').some((segment) => segment === '..' || segment === '.');
    if (unsafe) {
      throw new ThemeError('theme-bundle-invalid', `theme "${bundle.manifest.name}" has an unsafe file path: ${path}`, {
        path
      });
    }
    if (isProtectedPath(path)) {
      throw new ThemeError(
        'theme-bundle-invalid',
        `theme "${bundle.manifest.name}" writes into a content/kernel-owned path: ${path}`,
        { path }
      );
    }
  }
  const seen = new Set<string>();
  for (const file of bundle.files) {
    const folded = file.path.toLowerCase();
    if (seen.has(folded)) {
      throw new ThemeError(
        'theme-bundle-invalid',
        `theme "${bundle.manifest.name}" has case-colliding file paths: ${file.path}`,
        { path: file.path }
      );
    }
    seen.add(folded);
  }
  if (!bundle.files.some((file) => file.path === 'src/layouts/DocLayout.astro')) {
    throw new ThemeError(
      'theme-bundle-invalid',
      `theme "${bundle.manifest.name}" is missing the mandatory src/layouts/DocLayout.astro layout`,
      { theme: bundle.manifest.name }
    );
  }
};

const readManifest = async (path: string): Promise<ThemeFilesManifest | undefined> => {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as ThemeFilesManifest;
  } catch {
    // Absent or unreadable: legacy overwrite-only mode — nothing is deleted, everything is
    // (re)claimed by the new manifest.
    return undefined;
  }
};

const diskHash = async (path: string): Promise<string | undefined> => {
  try {
    return hashBytes(await readFile(path));
  } catch {
    return undefined;
  }
};

export const applyThemeBundle = async (input: ApplyThemeBundleInput): Promise<ApplyThemeBundleResult> => {
  const { siteRoot, bundle, force = false } = input;
  assertSafeBundlePaths(bundle);
  const previous = await readManifest(input.previousManifestPath);
  const previousByPath = new Map((previous?.files ?? []).map((file) => [file.path, file.hash]));
  const kernelConfigFiles = input.kernelConfigFiles ?? [];
  const newPaths = new Set([...bundle.files.map((file) => file.path), ...kernelConfigFiles.map((file) => file.path)]);

  const written: string[] = [];
  const deleted: string[] = [];
  const conflicts: ThemeConflict[] = [];
  const owned: ThemeOwnedFile[] = [];

  // 1. Previously-owned paths absent from the new bundle: delete only while unmodified.
  for (const [path, recordedHash] of previousByPath) {
    if (newPaths.has(path) || isProtectedPath(path)) {
      continue;
    }
    const onDisk = await diskHash(join(siteRoot, path));
    if (onDisk === undefined) {
      continue;
    }
    if (onDisk === recordedHash) {
      await rm(join(siteRoot, path), { force: true });
      deleted.push(path);
    } else {
      conflicts.push({ path, kind: 'kept' });
    }
  }

  // 2. Write the new bundle; a user-modified owned file is reported and skipped unless forced.
  for (const file of bundle.files) {
    const bytes = fileBytes(file);
    const newHash = hashBytes(bytes);
    const absolute = join(siteRoot, file.path);
    const recordedHash = previousByPath.get(file.path);
    const onDisk = await diskHash(absolute);
    const userModified =
      recordedHash !== undefined && onDisk !== undefined && onDisk !== recordedHash && onDisk !== newHash;
    if (userModified && !force) {
      conflicts.push({ path: file.path, kind: 'skipped' });
      // Record the INTENDED hash: the conflict must persist (never flip to a clean delete of the
      // user's file on a later switch).
      owned.push({ path: file.path, hash: newHash });
      continue;
    }
    if (onDisk !== newHash) {
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, bytes);
      written.push(file.path);
    }
    owned.push({ path: file.path, hash: newHash });
  }

  // 3. Kernel config files: always rewritten (theme hooks are an input, the kernel is the owner).
  for (const file of kernelConfigFiles) {
    const absolute = join(siteRoot, file.path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, file.content, 'utf8');
    written.push(file.path);
    owned.push({ path: file.path, hash: hashBytes(Buffer.from(file.content, 'utf8')) });
  }

  const manifest: ThemeFilesManifest = {
    theme: bundle.manifest.name,
    themeVersion: input.themeVersion,
    files: owned.toSorted((left, right) => left.path.localeCompare(right.path))
  };
  await mkdir(dirname(input.previousManifestPath), { recursive: true });
  await writeFile(input.previousManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return { written, deleted, conflicts };
};
