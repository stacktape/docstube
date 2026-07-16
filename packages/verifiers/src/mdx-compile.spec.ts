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
});
