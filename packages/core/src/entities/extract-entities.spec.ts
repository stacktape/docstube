import GithubSlugger, { slug as githubSlug } from 'github-slugger';
import { describe, expect, it } from 'vitest';
import { isRenderableAnchor, unrenderableAnchorPrefix } from '@docstube/contracts';
import { extractPageEntity, slugifyAnchor } from './extract-entities.ts';

const sampleMdx = `---
title: Installation
description: How to install.
---

# Installation

Install the package before anything else.

## Requirements

You need Node 24 or newer.

\`\`\`bash
npm install -g docstube
\`\`\`

## Configuration

<Callout kind="warning" compact>
  Never commit secrets.
</Callout>

| flag | meaning |
| ---- | ------- |
| -f   | force   |
`;

describe('extractPageEntity', () => {
  it('maps frontmatter, sections, and block types', () => {
    const page = extractPageEntity({ mdx: sampleMdx, slug: 'installation' });
    expect(page.title).toBe('Installation');
    expect(page.description).toBe('How to install.');
    // The H1 is the title, not a section; the paragraph after it is preamble.
    expect(page.preamble.map((block) => block.blockType)).toEqual(['paragraph']);
    expect(page.sections.map((section) => section.title)).toEqual(['Requirements', 'Configuration']);
    const requirements = page.sections[0];
    expect(requirements?.anchor).toBe('requirements');
    expect(requirements?.blocks.map((block) => block.blockType)).toEqual(['paragraph', 'code-example']);
    expect(requirements?.blocks[1]?.language).toBe('bash');
    const configuration = page.sections[1];
    expect(configuration?.blocks.map((block) => block.blockType)).toEqual(['component:Callout', 'table']);
    expect(configuration?.blocks[0]?.metadata).toEqual({ kind: 'warning', compact: true });
  });

  it('hashes code blocks by their body so verifiers can locate them', async () => {
    const { contentHash } = await import('@docstube/contracts');
    const page = extractPageEntity({ mdx: sampleMdx, slug: 'installation' });
    const codeBlock = page.sections[0]?.blocks[1];
    expect(codeBlock?.contentHash).toBe(contentHash('npm install -g docstube'));
  });

  it('deduplicates repeated section anchors exactly the way github-slugger does', () => {
    const mdx = '## Usage\n\ntext\n\n## Usage\n\nmore\n';
    const page = extractPageEntity({ mdx, slug: 'x' });
    expect(page.sections.map((section) => section.anchor)).toEqual(['usage', 'usage-1']);
  });

  it('treats the inline Claim marker as transparent — the owning block type never changes', () => {
    const inline = extractPageEntity({
      mdx: '# T\n\nIntro <Claim id="c1">`retries` defaults to 3.</Claim> outro.\n',
      slug: 'x'
    });
    expect(inline.preamble.map((block) => block.blockType)).toEqual(['paragraph']);

    // A multiline-formatted marker parses as a flow element, but Claim is claim vocabulary, not a
    // component: the block stays a paragraph so formatting never changes structural snapshots.
    const flow = extractPageEntity({
      mdx: '# T\n\n<Claim id="c1">\n  `retries` defaults to 3.\n</Claim>\n',
      slug: 'x'
    });
    expect(flow.preamble.map((block) => block.blockType)).toEqual(['paragraph']);
    expect(flow.preamble[0]?.blockType).not.toBe('component:Claim');
  });

  it('survives invalid frontmatter YAML and still recovers title/description leniently', () => {
    // Live regression: an unquoted description containing ": " is invalid YAML; extraction must
    // not crash on model output — the mdx-compile verifier owns reporting the syntax error.
    const mdx = [
      '---',
      'title: Configuration',
      'description: Configure the family: intent, ia, glossary',
      '---',
      '',
      'Body text.'
    ].join('\n');
    const page = extractPageEntity({ mdx, slug: 'configuration' });
    expect(page.title).toBe('Configuration');
    expect(page.description).toBe('Configure the family: intent, ia, glossary');
  });

  it('falls back to the ia title when no frontmatter or H1 exists', () => {
    const page = extractPageEntity({ mdx: 'Just a paragraph.', slug: 'notes', fallbackTitle: 'Notes' });
    expect(page.title).toBe('Notes');
    expect(page.preamble).toHaveLength(1);
  });
});

// ASTRO-ALIGNED ANCHORS (wave 2b close): section anchors must be byte-identical to the ids Astro
// puts on the rendered headings, or the per-section claim chips (resolved with
// getElementById(anchor)) attach to nothing — or, with repeated headings, to the wrong heading.
// Astro's rehypeHeadingIds runs ONE github-slugger over every heading in document order; these
// tests re-run that exact algorithm as the oracle.
describe('slugifyAnchor / github-slugger parity', () => {
  it('produces the same slug github-slugger does, including Unicode', () => {
    for (const heading of ['Getting Started (v2)!', 'Configuración avanzada', '日本語の見出し', 'C++ / C#', '---']) {
      expect(slugifyAnchor(heading)).toBe(githubSlug(heading));
    }
  });

  it('falls back to a SYNTHETIC unrenderable anchor where Astro itself would emit an empty id', () => {
    expect(githubSlug('.')).toBe('');
    // Never a real word: a substituted 'section' would collide with a genuine "## Section" heading
    // and mis-target its chip (impl-23 finding 3).
    expect(slugifyAnchor('.')).toBe(`${unrenderableAnchorPrefix}0`);
    expect(isRenderableAnchor(slugifyAnchor('.'))).toBe(false);
    expect(isRenderableAnchor(slugifyAnchor('Section'))).toBe(true);
  });

  it('matches the ids Astro derives for a whole document, h1 title included', () => {
    // The h1 is docstube's page title, not a section — but Astro still slugs it, so it occupies
    // "setup" and the identically-titled h2 must disambiguate to "setup-1".
    const mdx = [
      '# Setup',
      '',
      '## Setup',
      '',
      'a',
      '',
      '## Configuración avanzada',
      '',
      'b',
      '',
      '## Setup',
      '',
      'c',
      ''
    ].join('\n');
    const astro = new GithubSlugger();
    const expected = ['Setup', 'Setup', 'Configuración avanzada', 'Setup'].map((text) => astro.slug(text)).slice(1);
    const page = extractPageEntity({ mdx, slug: 'x' });
    expect(page.sections.map((section) => section.anchor)).toEqual(expected);
    expect(expected).toEqual(['setup-1', 'configuración-avanzada', 'setup-2']);
  });

  it('a punctuation-only heading CONSUMES its slugger slot without stealing a real slug (impl-23 finding 3)', () => {
    // Astro slugs "## ." to the empty string and records that slot; the following "## Section"
    // therefore keeps the plain "section" id. Substituting a real word for the empty slug would
    // consume "section" and push the real heading onto "section-1" — a chip aimed at nothing.
    const mdx = ['# Title', '', '## .', '', 'a', '', '## Section', '', 'b', ''].join('\n');
    const astro = new GithubSlugger();
    const astroIds = ['Title', '.', 'Section'].map((text) => astro.slug(text));
    expect(astroIds).toEqual(['title', '', 'section']);

    const page = extractPageEntity({ mdx, slug: 'x' });
    const [punctuation, real] = page.sections;
    expect(real?.anchor).toBe('section');
    expect(isRenderableAnchor(real?.anchor ?? '')).toBe(true);
    // The punctuation heading gets a synthetic, never-colliding anchor and is chipless.
    expect(punctuation?.anchor.startsWith(unrenderableAnchorPrefix)).toBe(true);
    expect(isRenderableAnchor(punctuation?.anchor ?? '')).toBe(false);
  });
});
