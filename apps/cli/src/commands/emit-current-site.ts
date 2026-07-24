import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { ConfigFamily, ManifestStore } from '@docstube/core';
import { configError } from '@docstube/core';
import { builtinThemes, emitSite } from '@docstube/theme';
import type { EmitSitePage, ThemeBundle } from '@docstube/theme';

const execFileAsync = promisify(execFile);

// Shared assemble step for generate/maintain/refine: read the committed state back and emit the
// self-contained site — source pages, verified translations, frozen-version labels, and a repo
// URL (from the git remote) so provenance citations linkify.

export const detectRepoUrl = async (workspaceDir: string): Promise<string | undefined> => {
  try {
    const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], { cwd: workspaceDir });
    const raw = stdout.trim();
    const sshMatch = raw.match(/^git@([^:]+):(.+?)(?:\.git)?$/u);
    if (sshMatch) {
      return `https://${sshMatch[1]}/${sshMatch[2]}`;
    }
    if (raw.startsWith('https://') || raw.startsWith('http://')) {
      return raw.replace(/\.git$/u, '');
    }
    return undefined;
  } catch {
    return undefined;
  }
};

// The CLI resolves the configured theme from the built-in registry — emitSite never performs a
// hidden lookup. An unknown name is a hard config error listing what is available.
export const resolveConfiguredTheme = async (themeName: string): Promise<ThemeBundle> => {
  const loadTheme = builtinThemes[themeName];
  if (loadTheme === undefined) {
    throw configError(
      `unknown theme "${themeName}" in docstube.yml — available themes: ${Object.keys(builtinThemes).join(', ')}`,
      { themeName, availableThemes: Object.keys(builtinThemes) }
    );
  }
  return loadTheme();
};

export type EmitCurrentSiteResult = {
  emitted: boolean;
  // Theme-owned files the user modified: preserved/skipped, reported by the calling command.
  themeConflicts: string[];
  // MDX↔shard binding failures: pages whose persisted MDX no longer matches the shard's recorded
  // mdxContentHash (or whose shard predates the hash) rendered UNVERIFIED. Printed loudly.
  warnings: string[];
};

export const emitCurrentSite = async (input: {
  workspaceDir: string;
  family: ConfigFamily;
  store: ManifestStore;
}): Promise<EmitCurrentSiteResult> => {
  const { workspaceDir, family, store } = input;
  const index = await store.readIndex();
  if (index === undefined) {
    return { emitted: false, themeConflicts: [], warnings: [] };
  }
  const readPages = async (locale: string): Promise<EmitSitePage[]> => {
    const pages: EmitSitePage[] = [];
    for (const entry of index.pages) {
      const shard = await store.readPageShard({ locale, pageId: entry.id });
      if (shard === undefined) {
        continue;
      }
      const mdxPath = locale === family.config.locales.source ? entry.path : `content/${locale}/${entry.slug}.mdx`;
      try {
        const mdx = await readFile(join(workspaceDir, family.config.outDir, mdxPath), 'utf8');
        pages.push({ shard, mdx });
      } catch {
        // A shard without its MDX (e.g. a flagged translation that never shipped) is skipped.
      }
    }
    return pages;
  };

  const pages = await readPages(family.config.locales.source);
  const translations = (await Promise.all(family.config.locales.targets.map(readPages))).flat();
  const frozenVersions = index.versions
    .filter((version) => version.status === 'frozen')
    .map((version) => version.label);
  const repoUrl = await detectRepoUrl(workspaceDir);
  const theme = await resolveConfiguredTheme(family.config.theme.name);

  const result = await emitSite({
    repoRoot: workspaceDir,
    outDir: family.config.outDir,
    config: family.config,
    index,
    theme,
    pages,
    ...(translations.length > 0 ? { translations } : {}),
    ...(frozenVersions.length > 0 ? { frozenVersions } : {}),
    ...(repoUrl === undefined ? {} : { repoUrl })
  });
  return {
    emitted: true,
    themeConflicts: result.themeConflicts.map((conflict) =>
      conflict.kind === 'kept'
        ? `${conflict.path} — modified by you, kept (the previous theme's copy was not deleted)`
        : `${conflict.path} — modified by you, not overwritten with the theme's copy`
    ),
    warnings: result.warnings
  };
};
