import { describe, expect, it } from 'vitest';
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

  it('deduplicates repeated section anchors', () => {
    const mdx = '## Usage\n\ntext\n\n## Usage\n\nmore\n';
    const page = extractPageEntity({ mdx, slug: 'x' });
    expect(page.sections.map((section) => section.anchor)).toEqual(['usage', 'usage-2']);
  });

  it('falls back to the ia title when no frontmatter or H1 exists', () => {
    const page = extractPageEntity({ mdx: 'Just a paragraph.', slug: 'notes', fallbackTitle: 'Notes' });
    expect(page.title).toBe('Notes');
    expect(page.preamble).toHaveLength(1);
  });
});

describe('slugifyAnchor', () => {
  it('produces url-safe anchors', () => {
    expect(slugifyAnchor('Getting Started (v2)!')).toBe('getting-started-v2');
    expect(slugifyAnchor('---')).toBe('section');
  });
});
