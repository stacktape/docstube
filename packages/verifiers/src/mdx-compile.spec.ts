import { describe, expect, it } from 'vitest';
import { mdxCompileVerifier } from './mdx-compile.ts';
import { makeArtifact, makeContext, makePage } from './test-support.ts';

describe('mdx-compile', () => {
  it('passes valid MDX and covers the checked page', async () => {
    const page = makePage({ slug: 'guide/install' });
    const artifact = makeArtifact(
      page,
      '# Install\n\nSome *mdx* content with a <Callout kind="info">note</Callout>.\n'
    );

    const result = await mdxCompileVerifier.verify(makeContext(), [artifact]);

    expect(result.status).toBe('pass');
    expect(result.findings).toEqual([]);
    expect(result.coveredEntityIds).toEqual([page.id]);
    expect(result.plugin).toBe('@docstube/verifiers');
  });

  it('does not fail on unknown JSX component names — compile only, no evaluation', async () => {
    const artifact = makeArtifact(makePage({ slug: 'guide' }), '<TotallyUnknownComponent prop="x" />\n');

    const result = await mdxCompileVerifier.verify(makeContext(), [artifact]);

    expect(result.status).toBe('pass');
  });

  it('fails frontmatter that is not valid YAML', async () => {
    // Live regression: remark treats the frontmatter fence as opaque, so an unquoted value
    // containing ": " compiled fine but crashed every downstream YAML consumer.
    const mdx = '---\ntitle: Configuration\ndescription: Configure the family: intent, ia\n---\n\nBody.\n';
    const artifact = makeArtifact(makePage({ slug: 'configuration' }), mdx);

    const result = await mdxCompileVerifier.verify(makeContext(), [artifact]);

    expect(result.status).toBe('fail');
    expect(result.findings[0]?.severity).toBe('error');
    expect(result.findings[0]?.message).toContain('frontmatter is not valid YAML');
  });

  it('accepts valid frontmatter', async () => {
    const mdx = '---\ntitle: "Configuration"\ndescription: "Configure the family: intent, ia"\n---\n\nBody.\n';
    const result = await mdxCompileVerifier.verify(makeContext(), [makeArtifact(makePage({ slug: 'ok' }), mdx)]);
    expect(result.status).toBe('pass');
  });

  it('fails broken JSX (unclosed tag) with line info', async () => {
    const artifact = makeArtifact(makePage({ slug: 'guide/broken' }), '# Title\n\n<Callout>\n\nnever closed\n');

    const result = await mdxCompileVerifier.verify(makeContext(), [artifact]);

    expect(result.status).toBe('fail');
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    expect(finding?.severity).toBe('error');
    expect(finding?.file).toBe('docs/guide/broken.mdx');
    expect(finding?.message).toMatch(/at line \d+/u);
    expect(finding?.span?.[0]).toBeGreaterThanOrEqual(1);
  });

  it('does not read frontmatter as prose — JSX-looking text in a quoted YAML value passes', async () => {
    // Live false-positive: the verifier compiled the RAW file, so this correct authored value —
    // which Astro accepts and every YAML consumer parses fine — failed as an unclosed JSX tag.
    const mdx =
      '---\ntitle: "Widgets"\ndescription: "Use <Widget> literally, and <b>never</b> close it"\n---\n\nBody.\n';

    const result = await mdxCompileVerifier.verify(makeContext(), [makeArtifact(makePage({ slug: 'widgets' }), mdx)]);

    expect(result.status).toBe('pass');
    expect(result.findings).toEqual([]);
  });

  it('reports body compile errors at SOURCE line numbers, not body-relative ones', async () => {
    // The unclosed tag is on source line 7; the compiler only ever sees the body, where it is
    // line 2. A finding that says "line 2" would send a human to the frontmatter.
    const mdx = ['---', 'title: "Broken"', 'description: "A page"', '---', '', '# Title', '<Callout>', ''].join('\n');
    expect(mdx.split('\n')[6]).toBe('<Callout>');

    const result = await mdxCompileVerifier.verify(makeContext(), [makeArtifact(makePage({ slug: 'broken' }), mdx)]);

    expect(result.status).toBe('fail');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.message).toContain('at line 7');
    expect(result.findings[0]?.span).toEqual([7, 7]);
    // No stale body-relative duplicate left inside the reason text.
    expect(result.findings[0]?.message).not.toMatch(/\(\d+:\d+/u);
  });

  it('reports malformed frontmatter as a YAML error, never as an MDX compile error', async () => {
    const mdx = '---\ntitle: Configuration\ndescription: unquoted: colon\n---\n\n# Fine body\n\nPlain prose.\n';

    const result = await mdxCompileVerifier.verify(makeContext(), [makeArtifact(makePage({ slug: 'bad-yaml' }), mdx)]);

    expect(result.status).toBe('fail');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.message).toContain('frontmatter is not valid YAML');
    expect(result.findings[0]?.message).not.toContain('MDX failed to compile');
  });
});
