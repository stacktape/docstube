import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { ConfigFamily, ManifestStore } from '@docstube/core';
import { configError, createManifestStore } from '@docstube/core';
import type { CliOutput } from '../cli-output.ts';
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
  // MDX↔shard binding failures (pages rendered UNVERIFIED because the persisted MDX no longer
  // matches the shard's recorded mdxContentHash, or the shard predates the hash) plus locale
  // routes that served the source fallback instead of a failed or REVISION-STALE translation
  // (locale shard's sourceContentRevision != current canonical mdxContentHash), plus authored
  // frontmatter blocks the kernel could not vet and therefore dropped. Printed loudly.
  warnings: string[];
  // Obsolete routes and .md twins removed because their page left the manifest or changed slug.
  pruned: string[];
};

export const emitCurrentSite = async (input: {
  workspaceDir: string;
  family: ConfigFamily;
  store: ManifestStore;
}): Promise<EmitCurrentSiteResult> => {
  const { workspaceDir, family, store } = input;
  const index = await store.readIndex();
  if (index === undefined) {
    return { emitted: false, themeConflicts: [], warnings: [], pruned: [] };
  }
  const fallbackWarnings: string[] = [];
  const readSourcePages = async (): Promise<EmitSitePage[]> => {
    const pages: EmitSitePage[] = [];
    for (const entry of index.pages) {
      const shard = await store.readPageShard({ locale: family.config.locales.source, pageId: entry.id });
      if (shard === undefined) {
        continue;
      }
      try {
        const mdx = await readFile(join(workspaceDir, family.config.outDir, entry.path), 'utf8');
        pages.push({ shard, mdx });
      } catch {
        // A shard without its MDX is skipped.
      }
    }
    return pages;
  };

  const pages = await readSourcePages();
  const sourceByPageId = new Map(pages.map((page) => [page.shard.page.id, page]));

  const readLocalePages = async (locale: string): Promise<EmitSitePage[]> => {
    const localePages: EmitSitePage[] = [];
    for (const entry of index.pages) {
      const shard = await store.readPageShard({ locale, pageId: entry.id });
      const mdxPath = `content/${locale}/${entry.slug}.mdx`;
      const source = sourceByPageId.get(entry.id);
      // NO 404s IN A CONFIGURED LOCALE (wave 2b close final; i18n-lifecycle-v2 decision 1): a page
      // with NO shard for this locale was never translated — a newly added locale, a page added
      // after the last localization pass, or a run that froze before reaching it. Skipping it
      // would leave a hole in the locale's nav and a missing route, which decision 1 forbids: every
      // configured locale shows EVERYTHING, untranslated pages marked. The route is built exactly
      // like the failed/stale case — source bytes, canonical proof, the not-yet-translated
      // notice — from a synthetic hashless locale shard (never persisted; it exists only to
      // address the route under this locale).
      if (shard === undefined) {
        if (source === undefined) {
          continue;
        }
        const {
          mdxContentHash: _hash,
          sourceContentRevision: _revision,
          translationAssurance: _assurance,
          ...unbound
        } = source.shard;
        fallbackWarnings.push(
          `page "${entry.slug}" (${locale}): no translation exists yet, so the route serves the source-locale ` +
            'content with a not-yet-translated notice. Re-run `docstube generate` to translate it'
        );
        localePages.push({ shard: { ...unbound, locale, flags: [] }, mdx: source.mdx, sourceFallback: true });
        continue;
      }
      // STALE LOCALE MDX NEVER SERVED (wave 2b close; i18n-lifecycle-v2 decision 1): a HASHLESS
      // locale shard means the pipeline persisted no locale bytes this state can vouch for — a
      // failed translation or retranslation. Any locale MDX still on disk is a PRIOR run's
      // artifact and must not be read; the route serves the fresh SOURCE content as the designed
      // fallback (with the canonical shard's proof and a visible not-yet-translated notice). The
      // stale file is ignored and reported, never silently rendered and never deleted here.
      if (shard.mdxContentHash === undefined) {
        if (source === undefined) {
          continue;
        }
        try {
          await stat(join(workspaceDir, family.config.outDir, mdxPath));
          fallbackWarnings.push(
            `page "${entry.slug}" (${locale}): the translation failed, so the stale locale MDX at ${mdxPath} is ` +
              'ignored — the route serves the source-locale content with a not-yet-translated notice. Re-run ' +
              '`docstube generate` to retranslate'
          );
        } catch {
          // No stale file: the fallback is the ordinary not-yet-translated state, nothing to report.
        }
        localePages.push({ shard, mdx: source.mdx, sourceFallback: true });
        continue;
      }
      // LOCALE REVISION GATE (wave 2b close, impl-21): the translated MDX is served ONLY while
      // the locale shard's recorded canonical revision (sourceContentRevision, minted at
      // translation success from the exact source bytes translated) equals the CURRENT canonical
      // shard's mdxContentHash. Any drift — a source change whose retranslation then failed,
      // froze, or was skipped; `docstube refine` updating only source artifacts — means the
      // canonical proof now describes DIFFERENT prose than the translation renders, so attaching
      // that proof to the old locale bytes would mark the wrong text. The route serves the source
      // fallback instead. This is deliberately STRICTER than i18n-lifecycle-v2 decision 1's
      // "stale-but-verified stays reachable with a warning": keeping the old prose reachable
      // honestly requires the retained HISTORICAL proof at the old revision, which is
      // reconciler-wave work — until then the gate fails closed. It also means generate/refine
      // never need to proactively invalidate locale shards: a stale shard is inert by comparison.
      if (source !== undefined && shard.sourceContentRevision !== source.shard.mdxContentHash) {
        fallbackWarnings.push(
          `page "${entry.slug}" (${locale}): the translation is stale — ` +
            (shard.sourceContentRevision === undefined
              ? 'the locale shard records no canonical source revision (pre-gate translation), '
              : 'the source page changed after it was translated, ') +
            `so the translated MDX at ${mdxPath} is not served; the route serves the current source-locale ` +
            'content with a not-yet-translated notice. Re-run `docstube generate` to retranslate'
        );
        localePages.push({ shard, mdx: source.mdx, sourceFallback: true });
        continue;
      }
      try {
        const mdx = await readFile(join(workspaceDir, family.config.outDir, mdxPath), 'utf8');
        localePages.push({ shard, mdx });
      } catch {
        // A shard without its MDX is skipped.
      }
    }
    return localePages;
  };

  const translations = (await Promise.all(family.config.locales.targets.map(readLocalePages))).flat();
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
    warnings: [...fallbackWarnings, ...result.warnings],
    pruned: result.pruned
  };
};

// The shared assemble step WITH its reporting, used by every command that mutates docs state
// (generate, refine, wizard) on BOTH the success path and the partial-failure path — so a run
// that throws mid-way still reconciles the rendered routes with whatever was persisted.
export const emitPersistedSite = async (
  workspaceDir: string,
  family: ConfigFamily,
  output: CliOutput
): Promise<EmitCurrentSiteResult> => {
  const store = createManifestStore(workspaceDir, family.config.versions.current);
  const result = await emitCurrentSite({ workspaceDir, family, store });
  for (const conflict of result.themeConflicts) {
    output.info(`  theme-conflict  ${conflict}`);
  }
  // Obsolete routes reconciled away (a removed page or a changed slug): reported, never silent.
  for (const path of result.pruned) {
    output.info(`  pruned  ${path} — no page in the current manifest routes here`);
  }
  // EMIT WARNINGS, NOT A TRUST STATE (wave 2b close): these lines carry several unrelated outcomes —
  // MDX↔shard binding failures, authored frontmatter that could not be vetted and was dropped,
  // ignored stale locale files, untranslated locale routes, unscannable directories. Labelling them
  // all "unverified" borrowed the page trust state's name for warnings that mostly do not touch it:
  // a dropped frontmatter block leaves the page's proof exactly as verified as it was. The label is
  // deliberately neutral; each warning says for itself what happened.
  for (const warning of result.warnings) {
    output.error(`  emit-warning  ${warning}`);
  }
  return result;
};
