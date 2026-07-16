import { describe, expect, it } from 'vitest';
import { extractProse, proseLintsVerifier } from './prose-lints.ts';
import { makeArtifact, makeContext, makePage } from './test-support.ts';

const verify = (mdx: string) => {
  const page = makePage({ slug: 'guide' });
  return proseLintsVerifier.verify(makeContext(), [makeArtifact(page, mdx)]);
};

describe('extractProse', () => {
  it('blanks code fences, inline code, imports, and JSX tags while keeping line numbers', () => {
    const mdx = [
      "import { Callout } from 'theme';",
      '',
      '# Title',
      '',
      '<Callout kind="info">',
      'Real prose with `inline code` inside.',
      '</Callout>',
      '',
      '```bash',
      'echo "we delve into shell"',
      '```',
      '',
      'After the fence.'
    ].join('\n');

    const prose = extractProse(mdx);
    const lines = prose.split('\n');
    expect(lines).toHaveLength(13);
    expect(prose).not.toContain('delve');
    expect(prose).not.toContain('inline code');
    expect(prose).not.toContain('import');
    expect(prose).not.toContain('Callout');
    expect(lines[5]).toContain('Real prose with');
    expect(lines[12]).toBe('After the fence.');
  });
});

describe('prose-lints', () => {
  it('flags banned AI-isms as warnings with the offending line', async () => {
    const mdx = '# Guide\n\nThis section will delve into configuration.\nIt is a game-changer for teams.\n';

    const result = await verify(mdx);

    expect(result.status).toBe('pass');
    expect(result.findings).toHaveLength(2);
    expect(result.findings.every((finding) => finding.severity === 'warning')).toBe(true);
    expect(result.findings[0]?.message).toContain('"delve"');
    expect(result.findings[0]?.span).toEqual([3, 3]);
    expect(result.findings[1]?.message).toContain('"game-changer"');
    expect(result.findings[1]?.span).toEqual([4, 4]);
  });

  it('matches banned phrases on word boundaries only', async () => {
    const result = await verify('# Guide\n\nThe delvefish is a fish; furthermore-ish words are fine.\n');

    expect(result.findings).toEqual([]);
  });

  it('does not flag banned words inside code fences', async () => {
    const result = await verify('# Guide\n\n```bash\necho "delve seamlessly"\n```\n\nNormal prose here.\n');

    expect(result.findings).toEqual([]);
  });

  it('flags 3+ consecutive sentences starting with the same word', async () => {
    const mdx =
      '# Guide\n\nDocstube reads your codebase carefully every run. Docstube writes the documentation pages. Docstube verifies every single claim it makes.\n';

    const result = await verify(mdx);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.severity).toBe('warning');
    expect(result.findings[0]?.message).toContain('"docstube"');
    expect(result.findings[0]?.message).toContain('3 consecutive sentences');
  });

  it('stays quiet on two same-start sentences', async () => {
    const result = await verify('# Guide\n\nDocstube reads code. Docstube writes docs. It also verifies claims.\n');

    expect(result.findings).toEqual([]);
  });

  it('flags 6+ consecutive sentences of near-identical length', async () => {
    const sentences = [
      'Alpha tools read the entire codebase.',
      'Beta agents write the documentation pages.',
      'Gamma checks verify every stated claim.',
      'Delta scripts render the final website.',
      'Epsilon jobs publish the built output.',
      'Zeta hooks report the run status.'
    ];
    const result = await verify(`# Guide\n\n${sentences.join(' ')}\n`);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.severity).toBe('warning');
    expect(result.findings[0]?.message).toContain('vary sentence length');
  });

  it('stays quiet on clean, varied prose', async () => {
    const mdx = [
      '# Guide',
      '',
      'Docstube reads your codebase. After that, generation begins with a plan for each persona.',
      'Verification follows, and every claim in every page must survive it before the gate opens.',
      '',
      'Short sentences help. So does a long, winding sentence that meanders through several clauses before finally arriving somewhere useful.'
    ].join('\n');

    const result = await verify(mdx);

    expect(result.status).toBe('pass');
    expect(result.findings).toEqual([]);
  });

  it('does not count sentences across headings or blank lines as consecutive', async () => {
    const mdx = [
      '# Guide',
      '',
      'Docstube reads code today.',
      '',
      'Docstube writes docs quickly.',
      '',
      '## Next',
      '',
      'Docstube verifies claims constantly.'
    ].join('\n');

    const result = await verify(mdx);

    expect(result.findings).toEqual([]);
  });
});
