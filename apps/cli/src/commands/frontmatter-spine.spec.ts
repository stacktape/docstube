import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  buildFixturePageShard,
  contentHash,
  contentHashSchema,
  docstubeConfigSchema,
  fixtureConfigInput,
  manifestIndexSchema,
  splitFrontmatter
} from '@docstube/contracts';
import { extractPageEntity, slugifyAnchor } from '@docstube/core';
import { builtinThemes, emitSite } from '@docstube/theme';

// THE CROSS-BOUNDARY REGRESSION (wave 2b close, spine finding): the kernel (core extraction,
// agent-runtime marker scanning) and emission (theme) must read the SAME bytes as frontmatter.
// While emission was tolerant of a BOM and of blank lines above the delimiter and the kernel was
// not, a page whose `---` sat under a blank line parsed two different ways: extraction saw a
// thematic break plus a setext heading and minted a SYNTHETIC section out of the `title:` text,
// anchoring section proof to it — and emission stripped that exact text as frontmatter, so the
// recorded anchor addressed a heading no rendered page contains. The CLI is where both sides meet,
// so the agreement is proved here, end to end.

const bodyMdx = '# Installation\n\nInstall it first.\n\n## Requirements\n\nNode 24 or newer.\n';
const plainMdx = `---\ntitle: "Installation"\ndescription: "How to install."\n---\n\n${bodyMdx}`;

// Everything the emitted route renders as prose: after the kernel's own frontmatter block.
const routeBodyOf = (route: string): string => {
  const split = splitFrontmatter(route);
  expect(split.hadFrontmatter).toBe(true);
  return split.body;
};

// The heading ids Astro will actually put on the rendered page, derived from the route's own
// headings by the extraction slugger — the set every recorded section anchor must live in.
const renderedAnchors = (routeBody: string): string[] =>
  [...routeBody.matchAll(/^#{2,6}[ \t]+(.+?)[ \t]*$/gmu)].map((match) => slugifyAnchor(match[1] ?? ''));

const emitPageMdx = async (mdx: string, label: string) => {
  const page = extractPageEntity({ mdx, slug: 'getting-started/installation' });
  const shard = {
    ...buildFixturePageShard(page),
    mdxContentHash: contentHashSchema.parse(contentHash(mdx))
  };
  const repoRoot = await mkdtemp(join(tmpdir(), `docstube-cli-fm-${label}-`));
  await emitSite({
    repoRoot,
    outDir: 'docs-site',
    config: docstubeConfigSchema.parse(fixtureConfigInput),
    index: manifestIndexSchema.parse({
      schemaVersion: 1,
      docstubeVersion: '0.0.2',
      sourceLocale: 'en',
      locales: ['en'],
      versions: [{ label: 'latest', status: 'current' }],
      pages: [{ id: page.id, slug: page.slug, title: page.title, path: `docs/${page.slug}.mdx` }],
      configHash: 'a'.repeat(64),
      iaHash: 'b'.repeat(64)
    }),
    theme: await builtinThemes.basic!(),
    pages: [{ shard, mdx }]
  });
  const route = await readFile(join(repoRoot, 'docs-site/src/pages/getting-started/installation.mdx'), 'utf8');
  return { page, route };
};

describe('kernel and emission split frontmatter identically', () => {
  it.each([
    ['an ordinary block', plainMdx],
    ['a UTF-8 BOM before the delimiter', `${String.fromCharCode(0xfeff)}${plainMdx}`],
    ['blank lines above the delimiter', `\n\n${plainMdx}`]
  ])('agrees on body and section anchors for a page with %s', async (label, mdx) => {
    const { page, route } = await emitPageMdx(mdx, label.replaceAll(' ', '-').slice(0, 20));

    // KERNEL SIDE: the frontmatter is frontmatter, so no synthetic section is minted from it.
    expect(page.title).toBe('Installation');
    expect(page.sections.map((section) => section.title)).toEqual(['Requirements']);

    // EMISSION SIDE: the page body the route renders is exactly the body the kernel extracted from.
    const routeBody = routeBodyOf(route);
    expect(routeBody).toContain(splitFrontmatter(mdx).body.trim());
    expect(routeBody).not.toContain('title: "Installation"');

    // THE AGREEMENT: every recorded section anchor exists as a heading id in the rendered route.
    const recorded = parse(splitFrontmatter(route).frontmatter) as { docstubeSections?: Array<{ anchor: string }> };
    const anchors = (recorded.docstubeSections ?? []).map((section) => section.anchor);
    expect(anchors).toEqual(page.sections.map((section) => section.anchor));
    expect(anchors).toEqual(['requirements']);
    for (const anchor of anchors) {
      expect(renderedAnchors(routeBody)).toContain(anchor);
    }
  });
});
