import { describe, expect, it } from 'vitest';
import { canonicalMdxSource, splitFrontmatter } from './frontmatter.ts';

const BOM = String.fromCharCode(0xfeff);
const body = '# Installation\n\n## Requirements\n\nNode 24 or newer.\n';

describe('splitFrontmatter', () => {
  it('splits an ordinary block', () => {
    const split = splitFrontmatter(`---\ntitle: Installation\n---\n\n${body}`);
    expect(split).toMatchObject({ frontmatter: 'title: Installation', body: `\n${body}`, hadFrontmatter: true });
  });

  // The three forms Astro accepts and remark's strict rule does not. Every one of them used to
  // split differently on the two sides of the boundary.
  it.each([
    ['a UTF-8 BOM before the delimiter', `${BOM}---\ntitle: Installation\n---\n\n${body}`],
    ['blank lines above the delimiter', `\n\n---\ntitle: Installation\n---\n\n${body}`],
    ['whitespace-only lines above the delimiter', `  \n\t\n---\ntitle: Installation\n---\n\n${body}`]
  ])('accepts %s', (_label, source) => {
    const split = splitFrontmatter(source);
    expect(split.hadFrontmatter).toBe(true);
    expect(split.frontmatter).toBe('title: Installation');
    expect(split.body).toBe(`\n${body}`);
    // The canonical source starts at the delimiter, so a Markdown parser sees the same block.
    expect(split.canonicalSource.startsWith('---\n')).toBe(true);
  });

  it('accepts CRLF line endings', () => {
    const split = splitFrontmatter('---\r\ntitle: Installation\r\n---\r\n\r\nBody.\r\n');
    expect(split).toMatchObject({ frontmatter: 'title: Installation', body: '\r\nBody.\r\n', hadFrontmatter: true });
  });

  // An empty block is frontmatter PRESENT with no keys, not frontmatter absent.
  it('reports an empty block as present', () => {
    const split = splitFrontmatter(`---\n---\n\n${body}`);
    expect(split).toMatchObject({ frontmatter: '', body: `\n${body}`, hadFrontmatter: true });
  });

  it('leaves a document without frontmatter whole, BOM removed', () => {
    expect(splitFrontmatter(body)).toMatchObject({ frontmatter: '', body, hadFrontmatter: false });
    expect(splitFrontmatter(`${BOM}${body}`)).toMatchObject({ body, hadFrontmatter: false });
  });

  it('never mistakes a `---` thematic rule in the body for a frontmatter delimiter', () => {
    const rule = '# Installation\n\nBefore.\n\n---\n\nAfter.\n';
    expect(splitFrontmatter(rule)).toMatchObject({ frontmatter: '', body: rule, hadFrontmatter: false });
  });

  it('leaves an unterminated block as body', () => {
    const unterminated = '---\ntitle: Installation\n\nBody.\n';
    expect(splitFrontmatter(unterminated)).toMatchObject({ hadFrontmatter: false, body: unterminated });
  });
});

describe('canonicalMdxSource', () => {
  it('strips only what stops a parser from seeing the block', () => {
    const source = `${BOM}\n\n---\ntitle: Installation\n---\n\n${body}`;
    expect(canonicalMdxSource(source)).toBe(`---\ntitle: Installation\n---\n\n${body}`);
  });

  it('keeps a document that has no frontmatter byte-identical apart from the BOM', () => {
    expect(canonicalMdxSource(`\n\n${body}`)).toBe(`\n\n${body}`);
    expect(canonicalMdxSource(`${BOM}${body}`)).toBe(body);
  });
});
