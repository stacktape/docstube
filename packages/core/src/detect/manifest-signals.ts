import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DocType } from '@docstube/contracts';

// Manifest sniffing for the deterministic detection engine. Pure fs reads only — no subprocesses,
// no agent calls. A field is set only when the signal is unambiguous (PRODUCT §3.9.2).

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export type PackageManifest = {
  name?: string | undefined;
  description?: string | undefined;
  private?: boolean | undefined;
  main?: string | undefined;
  exports?: unknown;
  packageManager?: string | undefined;
  workspaces?: unknown;
  dependencies?: Record<string, string> | undefined;
  devDependencies?: Record<string, string> | undefined;
};

export const readPackageManifest = async (repoRoot: string): Promise<PackageManifest | undefined> => {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'));
  } catch {
    return undefined;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  return raw as PackageManifest;
};

const frameworkDeps: Array<{ dep: string; framework: string }> = [
  { dep: 'react', framework: 'react' },
  { dep: 'next', framework: 'next' },
  { dep: 'astro', framework: 'astro' },
  { dep: 'vue', framework: 'vue' },
  { dep: 'svelte', framework: 'svelte' },
  { dep: 'express', framework: 'express' },
  { dep: 'hono', framework: 'hono' },
  { dep: 'fastify', framework: 'fastify' },
  { dep: '@nestjs/core', framework: 'nest' }
];

// Frameworks that signal an application/server rather than a library. UI libraries alone (react,
// vue, svelte) are ambiguous — a component library depends on them too — so they never decide
// docType by themselves.
const appFrameworks = new Set(['next', 'astro', 'express', 'hono', 'fastify', 'nest']);

const allDeps = (pkg: PackageManifest): Record<string, string> => ({
  ...pkg.dependencies,
  ...pkg.devDependencies
});

export const detectFrameworks = (pkg: PackageManifest | undefined): string[] => {
  if (!pkg) {
    return [];
  }
  const deps = allDeps(pkg);
  return frameworkDeps.filter(({ dep }) => dep in deps).map(({ framework }) => framework);
};

export const detectDocType = (pkg: PackageManifest | undefined, frameworks: string[]): DocType | undefined => {
  if (!pkg) {
    return undefined;
  }
  if (pkg.private === true) {
    return 'internal';
  }
  const hasLibraryEntry = typeof pkg.main === 'string' || pkg.exports != null;
  if (hasLibraryEntry) {
    return 'external-library';
  }
  if (frameworks.some((framework) => appFrameworks.has(framework))) {
    return 'external-product';
  }
  return undefined;
};

const lockfileManagers: Array<{ file: string; manager: PackageManager }> = [
  { file: 'package-lock.json', manager: 'npm' },
  { file: 'pnpm-lock.yaml', manager: 'pnpm' },
  { file: 'yarn.lock', manager: 'yarn' },
  { file: 'bun.lockb', manager: 'bun' },
  { file: 'bun.lock', manager: 'bun' }
];

export const detectPackageManager = (
  pkg: PackageManifest | undefined,
  rootFileNames: ReadonlySet<string>
): PackageManager | undefined => {
  const fieldMatch = pkg?.packageManager?.match(/^(npm|pnpm|yarn|bun)(@|$)/);
  if (fieldMatch?.[1]) {
    return fieldMatch[1] as PackageManager;
  }
  const fromLockfiles = new Set(
    lockfileManagers.filter(({ file }) => rootFileNames.has(file)).map(({ manager }) => manager)
  );
  // Conflicting lockfiles are ambiguous — leave blank rather than guess.
  if (fromLockfiles.size !== 1) {
    return undefined;
  }
  return [...fromLockfiles][0];
};

export const detectLanguages = (pkg: PackageManifest | undefined, rootFileNames: ReadonlySet<string>): string[] => {
  const languages: string[] = [];
  if (rootFileNames.has('tsconfig.json') || (pkg !== undefined && 'typescript' in allDeps(pkg))) {
    languages.push('typescript');
  }
  if (['pyproject.toml', 'setup.py', 'requirements.txt'].some((file) => rootFileNames.has(file))) {
    languages.push('python');
  }
  if (['pom.xml', 'build.gradle', 'build.gradle.kts'].some((file) => rootFileNames.has(file))) {
    languages.push('java');
  }
  return languages;
};

export const detectMonorepo = (pkg: PackageManifest | undefined, rootFileNames: ReadonlySet<string>): boolean =>
  rootFileNames.has('pnpm-workspace.yaml') || rootFileNames.has('lerna.json') || pkg?.workspaces != null;

export const humanizePackageName = (name: string): string | undefined => {
  const bare = name.includes('/') ? (name.split('/').pop() ?? '') : name;
  const words = bare.split(/[-_.]+/).filter((word) => word.length > 0);
  if (words.length === 0) {
    return undefined;
  }
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
};
