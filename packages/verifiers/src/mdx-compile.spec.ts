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
