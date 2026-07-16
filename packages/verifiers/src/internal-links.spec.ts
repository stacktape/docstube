import { describe, expect, it } from 'vitest';
import { findLinks, internalLinksVerifier } from './internal-links.ts';
import { makeArtifact, makeContext, makePage, makeSection } from './test-support.ts';

describe('findLinks', () => {
  it('extracts markdown links and <a href> targets with line numbers, skipping images', () => {
    const mdx =
      '# Title\n\nSee [usage](/guide/usage) and ![shot](/images/shot.png).\n\n<a href="/guide/install">install</a>\n';
    const links = findLinks(mdx);
    expect(links).toContainEqual({ target: '/guide/usage', line: 3 });
    expect(links).toContainEqual({ target: '/guide/install', line: 5 });
    expect(links.map((link) => link.target)).not.toContain('/images/shot.png');
  });
});

describe('internal-links', () => {
  const install = makePage({ slug: 'guide/install', sections: [makeSection({ anchor: 'requirements' })] });
  const usage = makePage({ slug: 'guide/usage' });

  it('passes links that resolve to another page slug, tolerating slashes and #anchor suffixes', async () => {
    const artifacts = [
      makeArtifact(
        install,
        'See [usage](/guide/usage), [again](guide/usage/), and [anchored](/guide/usage#whatever).\n'
      ),
      makeArtifact(usage, 'Back to [install](/guide/install).\n')
    ];

    const result = await internalLinksVerifier.verify(makeContext(), artifacts);

    expect(result.status).toBe('pass');
    expect(result.findings).toEqual([]);
    expect(result.coveredEntityIds).toEqual([install.id, usage.id]);
  });

  it('ignores http(s), mailto, and protocol-relative targets', async () => {
    const artifact = makeArtifact(
      usage,
      '[a](https://example.com/missing) [b](http://example.com) [c](mailto:hi@example.com) [d](//cdn.example.com/x)\n'
    );

    const result = await internalLinksVerifier.verify(makeContext(), [artifact]);

    expect(result.status).toBe('pass');
    expect(result.findings).toEqual([]);
  });

  it('fails a dead internal link with the target and source page', async () => {
    const artifact = makeArtifact(usage, 'Go [nowhere](/guide/missing).\n');

    const result = await internalLinksVerifier.verify(makeContext(), [artifact, makeArtifact(install, 'no links\n')]);

    expect(result.status).toBe('fail');
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    expect(finding?.severity).toBe('error');
    expect(finding?.message).toContain('/guide/missing');
    expect(finding?.message).toContain('guide/usage');
    expect(finding?.file).toBe('docs/guide/usage.mdx');
    expect(finding?.entity?.pageId).toBe(usage.id);
  });

  it('resolves same-page #anchors against section anchors', async () => {
    const good = await internalLinksVerifier.verify(makeContext(), [
      makeArtifact(install, 'Jump to [requirements](#requirements).\n')
    ]);
    expect(good.status).toBe('pass');

    const bad = await internalLinksVerifier.verify(makeContext(), [
      makeArtifact(install, 'Jump to [nope](#does-not-exist).\n')
    ]);
    expect(bad.status).toBe('fail');
    expect(bad.findings[0]?.message).toContain('#does-not-exist');
  });

  it('fails dead <a href> targets too', async () => {
    const artifact = makeArtifact(install, '<a href="/guide/missing2">dead</a>\n');

    const result = await internalLinksVerifier.verify(makeContext(), [artifact]);

    expect(result.status).toBe('fail');
    expect(result.findings[0]?.message).toContain('/guide/missing2');
  });
});
