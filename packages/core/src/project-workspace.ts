import { mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { join as posixJoin, normalize as posixNormalize } from 'node:path/posix';
import { relativePathSchema } from '@docstube/contracts';
import type { DocstubeConfig, Glossary, Ia, RelativePath, Sha256 } from '@docstube/contracts';
import { loadDocstubeConfig, loadGlossary, loadIa } from './config-yaml.ts';
import { hashNormalizedSource, hashSeedContext } from './incremental-engine.ts';
import type { ScheduledPage } from './pipeline-run.ts';

export type ProjectConfigFamily = {
  config: DocstubeConfig;
  configDir: string;
  configPath: string;
  glossary: Glossary;
  ia: Ia;
};

export type ProjectSourceFile = {
  content: string;
  hash: Sha256;
  path: RelativePath;
};

export type PageSeedContext = {
  docsType: DocstubeConfig['docsType'];
  layout: DocstubeConfig['output']['layout'];
  page: {
    brief?: string;
    id: string;
    slug: string;
    title: string;
  };
  personas: string[];
  site: {
    description?: string;
    name: string;
  };
  sources: readonly {
    hash: Sha256;
    path: RelativePath;
  }[];
};

export const defaultConfigPath = 'docstube.yml';

export const docstubeDirPath = (workspaceDir: string): string => join(workspaceDir, '.docstube');

export const projectDbPath = (workspaceDir: string): string => join(docstubeDirPath(workspaceDir), 'db.sqlite');

export const projectManifestPath = (workspaceDir: string): string =>
  join(docstubeDirPath(workspaceDir), 'manifest.yml');

export const ensureDocstubeDir = async (workspaceDir: string): Promise<void> => {
  await mkdir(docstubeDirPath(workspaceDir), { recursive: true });
};

export const pathExists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

export const normalizeRelativePath = (path: string): RelativePath =>
  relativePathSchema.parse(path.replaceAll('\\', '/'));

export const toNativePath = (path: RelativePath): string => path.split('/').join(sep);

export const resolveWorkspacePath = (workspaceDir: string, path: RelativePath): string => {
  const root = resolve(workspaceDir);
  const target = resolve(root, toNativePath(path));
  const rootWithSeparator = root.endsWith(sep) ? root : `${root}${sep}`;

  if (target !== root && !target.startsWith(rootWithSeparator)) {
    throw new Error(`path escapes workspace: ${path}`);
  }

  return target;
};

export const relativeFromWorkspace = (workspaceDir: string, path: string): RelativePath =>
  normalizeRelativePath(relative(workspaceDir, path));

export const outputPathForPage = (config: DocstubeConfig, page: ScheduledPage): RelativePath =>
  normalizeRelativePath(posixNormalize(posixJoin(config.output.dir, page.slug)));

export const withOutputPaths = (config: DocstubeConfig, pages: readonly ScheduledPage[]): ScheduledPage[] =>
  pages.map((page) => ({ ...page, slug: outputPathForPage(config, page) }));

export const loadProjectConfigFamily = async (
  workspaceDir: string,
  configPath = defaultConfigPath
): Promise<ProjectConfigFamily> => {
  const normalizedConfigPath = normalizeRelativePath(configPath);
  const config = loadDocstubeConfig(await readFile(resolveWorkspacePath(workspaceDir, normalizedConfigPath), 'utf8'));
  const configDir = dirname(normalizedConfigPath).replaceAll('\\', '/');
  const configRelative = configDir === '.' ? '' : configDir;
  const resolveConfigRelative = (path: RelativePath): RelativePath =>
    normalizeRelativePath(configRelative ? posixJoin(configRelative, path) : path);
  const [ia, glossary] = await Promise.all([
    readFile(resolveWorkspacePath(workspaceDir, resolveConfigRelative(config.ia)), 'utf8').then(loadIa),
    readFile(resolveWorkspacePath(workspaceDir, resolveConfigRelative(config.glossary)), 'utf8').then(loadGlossary)
  ]);

  return {
    config,
    configDir,
    configPath: normalizedConfigPath,
    ia,
    glossary
  };
};

const sourceFileExtensions = new Set([
  '.cjs',
  '.css',
  '.js',
  '.jsx',
  '.json',
  '.md',
  '.mdx',
  '.mjs',
  '.py',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml'
]);

const ignoredDirectoryNames = new Set([
  '.docstube',
  '.git',
  '.hg',
  '.svn',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules'
]);

const extensionForPath = (path: string): string => {
  const index = path.lastIndexOf('.');
  return index >= 0 ? path.slice(index).toLowerCase() : '';
};

const collectSourceFilesFromPath = async (input: {
  outputDir: RelativePath;
  path: RelativePath;
  workspaceDir: string;
}): Promise<ProjectSourceFile[]> => {
  const absolute = resolveWorkspacePath(input.workspaceDir, input.path);
  const stats = await stat(absolute).catch(() => null);
  if (!stats) {
    return [];
  }

  if (stats.isFile()) {
    if (!sourceFileExtensions.has(extensionForPath(input.path))) {
      return [];
    }
    const content = await readFile(absolute, 'utf8');
    return [{ path: input.path, content, hash: hashNormalizedSource(content) }];
  }

  if (!stats.isDirectory()) {
    return [];
  }

  const entries = await readdir(absolute, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry): Promise<ProjectSourceFile[]> => {
      if (entry.isDirectory() && ignoredDirectoryNames.has(entry.name)) {
        return [];
      }

      const childPath = normalizeRelativePath(posixJoin(input.path, entry.name));
      if (childPath === input.outputDir || childPath.startsWith(`${input.outputDir}/`)) {
        return [];
      }
      return collectSourceFilesFromPath({ ...input, path: childPath });
    })
  );

  return files.flat();
};

export const collectProjectSourceFiles = async (input: {
  config: DocstubeConfig;
  workspaceDir: string;
}): Promise<ProjectSourceFile[]> => {
  const configuredPaths = (input.config.sources ?? [])
    .filter((source) => source.kind === 'path')
    .map((source) => source.path);
  const roots = configuredPaths.length > 0 ? configuredPaths : (['src'] as const);
  const files = await Promise.all(
    roots.map((path) =>
      collectSourceFilesFromPath({ workspaceDir: input.workspaceDir, outputDir: input.config.output.dir, path })
    )
  );
  const byPath = new Map(files.flat().map((file) => [file.path, file]));
  return [...byPath.values()].toSorted((left, right) => left.path.localeCompare(right.path));
};

export const createPageSeedContext = (input: {
  config: DocstubeConfig;
  page: ScheduledPage;
  sources: readonly ProjectSourceFile[];
}): PageSeedContext => ({
  docsType: input.config.docsType,
  layout: input.config.output.layout,
  site: {
    name: input.config.site.name,
    description: input.config.site.description
  },
  personas: input.config.personas.map((persona) => persona.id).toSorted(),
  page: {
    id: input.page.id,
    title: input.page.title,
    brief: input.page.brief,
    slug: input.page.slug
  },
  sources: input.sources.map((source) => ({ path: source.path, hash: source.hash }))
});

export const sourceFilesForPage = (
  page: ScheduledPage,
  sources: readonly ProjectSourceFile[]
): readonly ProjectSourceFile[] => {
  const pageSegments = page.id.split('/');
  const leaf = pageSegments.at(-1) ?? page.id;
  const pathTokens = new Set([page.id, leaf, page.slug.replace(/\.mdx$/u, '')]);
  const matches = sources.filter((source) => {
    const path = source.path.toLowerCase();
    return [...pathTokens].some((token) => path.includes(token.toLowerCase()));
  });

  if (matches.length > 0) {
    return matches;
  }

  return page.id === 'overview' ? sources : [];
};

export const createCurrentSeedHashes = (input: {
  config: DocstubeConfig;
  pages: readonly ScheduledPage[];
  sources: readonly ProjectSourceFile[];
}): Record<string, Sha256> =>
  Object.fromEntries(
    input.pages.map((page) => [
      page.id,
      hashSeedContext(
        createPageSeedContext({
          config: input.config,
          page,
          sources: sourceFilesForPage(page, input.sources)
        })
      )
    ])
  );
