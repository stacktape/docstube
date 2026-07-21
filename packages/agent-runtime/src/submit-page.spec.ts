import { describe, expect, it } from 'vitest';
import { createSubmitPageTool, scanClaimMarkers, submitPageDescriptor, validateSubmission } from './submit-page.ts';

const mdxWith = (body: string): string => `---\ntitle: "Retry"\n---\n\n# Retry\n\n${body}\n`;

const ledgerWith = (claims: unknown[]): unknown => ({ schemaVersion: 1, claims });

const claim = (markerId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  markerId,
  class: 'value',
  predicate: 'retries defaults to 3',
  ...overrides
});

describe('scanClaimMarkers', () => {
  it('finds inline markers with offsets and inner MDX', () => {
    const mdx = 'Intro. <Claim id="c1">`retries` defaults to 3.</Claim> Outro.';
    const scan = scanClaimMarkers(mdx);
    expect(scan.errors).toEqual([]);
    expect(scan.markers).toHaveLength(1);
    expect(scan.markers[0]).toMatchObject({ markerId: 'c1', innerMdx: '`retries` defaults to 3.' });
    expect(mdx.slice(scan.markers[0]!.offset)).toMatch(/^<Claim id="c1">/);
  });

  it('ignores literal <Claim> examples inside fenced code and inline code as plain text', () => {
    const mdx = [
      'Wrap facts like this:',
      '',
      '```mdx',
      '<Claim id="c1">`retries` defaults to 3.</Claim>',
      '```',
      '',
      'Inline form: `<Claim id="c2">text</Claim>`.'
    ].join('\n');
    const scan = scanClaimMarkers(mdx);
    expect(scan.markers).toEqual([]);
    expect(scan.errors).toEqual([]);
  });

  it('rejects flow-level (block/multiline) Claim elements with a precise repair error', () => {
    const mdx = ['<Claim id="c1">', '  `retries` defaults to 3.', '</Claim>'].join('\n');
    const scan = scanClaimMarkers(mdx);
    expect(scan.markers).toEqual([]);
    expect(scan.errors[0]?.code).toBe('marker-flow');
    expect(scan.errors[0]?.message).toContain('inline inside the sentence');
  });

  it('rejects markers inside headings and inside JSX expressions', () => {
    const heading = scanClaimMarkers('## Setup <Claim id="h1">is easy</Claim>\n\nBody.\n');
    expect(heading.errors[0]?.code).toBe('marker-in-heading');
    expect(heading.markers).toEqual([]);

    const expression = scanClaimMarkers('Value: {<Claim id="e1">3</Claim>} done.\n');
    expect(expression.errors.some((error) => error.code === 'marker-in-expression')).toBe(true);
  });

  it('reports empty, nested, and id-less markers precisely', () => {
    const empty = scanClaimMarkers('Text <Claim id="a">   </Claim> more.');
    expect(empty.errors[0]?.code).toBe('marker-empty');

    const selfClosing = scanClaimMarkers('Text <Claim id="a"/> more.');
    expect(selfClosing.errors[0]?.code).toBe('marker-empty');
    expect(selfClosing.errors[0]?.message).toContain('self-closing');

    const nested = scanClaimMarkers('Text <Claim id="a">x <Claim id="b">y</Claim></Claim> more.');
    expect(nested.errors[0]?.code).toBe('marker-nested');

    const noId = scanClaimMarkers('Text <Claim>text</Claim> more.');
    expect(noId.errors[0]?.code).toBe('marker-missing-id');

    const badId = scanClaimMarkers('Text <Claim id="not valid!">text</Claim> more.');
    expect(badId.errors[0]?.code).toBe('marker-invalid-id');
  });

  it('turns malformed marker syntax into an mdx-parse-error repair message, never a crash', () => {
    const unclosed = scanClaimMarkers('Text <Claim id="a">never closed.');
    expect(unclosed.errors[0]?.code).toBe('mdx-parse-error');
    const stray = scanClaimMarkers('Text </Claim> stray.');
    expect(stray.errors[0]?.code).toBe('mdx-parse-error');
  });
});

describe('submitPageDescriptor', () => {
  it('exposes the full writer-ledger schema (claim fields and proposal unions) to vendor tool calling', () => {
    const ledgerSchema = (submitPageDescriptor.paramsJsonSchema as { properties: Record<string, unknown> }).properties
      .ledger as Record<string, unknown>;
    const serialized = JSON.stringify(ledgerSchema);
    for (const field of ['markerId', 'class', 'predicate', 'proposedEvidence', 'proposedSubscriptions']) {
      expect(serialized).toContain(`"${field}"`);
    }
    // The proposal unions are spelled out, not `{type: object}`.
    for (const kind of ['symbol', 'file', 'url', 'check', 'signature', 'cited-value', 'body', 'file-content']) {
      expect(serialized).toContain(`"${kind}"`);
    }
    expect(serialized).not.toContain('$schema');
  });
});

describe('validateSubmission', () => {
  it('accepts a well-formed submission and parses ledger defaults', () => {
    const outcome = validateSubmission({
      mdx: mdxWith('<Claim id="c1">`retries` defaults to 3.</Claim>'),
      ledger: ledgerWith([claim('c1')])
    });
    expect(outcome.errors).toEqual([]);
    expect(outcome.accepted?.ledger.claims[0]).toMatchObject({
      markerId: 'c1',
      proposedEvidence: [],
      proposedSubscriptions: []
    });
  });

  it('accepts a hash-less file-content subscription proposal (conservative fallback shape)', () => {
    const outcome = validateSubmission({
      mdx: mdxWith('<Claim id="c1">`retries` defaults to 3.</Claim>'),
      ledger: ledgerWith([claim('c1', { proposedSubscriptions: [{ kind: 'file-content', file: 'src/retry.ts' }] })])
    });
    expect(outcome.errors).toEqual([]);
    expect(outcome.accepted?.ledger.claims[0]?.proposedSubscriptions[0]).toEqual({
      kind: 'file-content',
      file: 'src/retry.ts'
    });
  });

  it('rejects value laundering IN-SESSION: citedValue absent from both the marked prose and the predicate', () => {
    // The impl-06 finding-1 probe: prose asserts "is totally-wrong", the ledger smuggles the
    // correct source value. The deterministic binding rejects it while the model can still repair.
    const symbolHash = `ts:${'a'.repeat(64)}`;
    const outcome = validateSubmission({
      mdx: mdxWith('<Claim id="c1">`retries` is totally-wrong.</Claim>'),
      ledger: ledgerWith([
        claim('c1', {
          predicate: 'retries is totally-wrong',
          proposedSubscriptions: [{ kind: 'cited-value', symbolHash, valueName: 'retries.default', citedValue: '3' }]
        })
      ])
    });
    expect(outcome.accepted).toBeUndefined();
    expect(outcome.errors).toHaveLength(1);
    expect(outcome.errors[0]).toContain('c1');
    expect(outcome.errors[0]).toContain('appears in NEITHER');
    expect(outcome.errors[0]).toContain('retries.default');
  });

  it('binds cited values through the shared normalization: bare, quoted, and numeric spellings agree', () => {
    const symbolHash = `ts:${'a'.repeat(64)}`;
    const withValue = (prose: string, citedValue: string) =>
      validateSubmission({
        mdx: mdxWith(`<Claim id="c1">${prose}</Claim>`),
        ledger: ledgerWith([
          claim('c1', {
            predicate: 'the backoff mode has a default',
            proposedSubscriptions: [{ kind: 'cited-value', symbolHash, valueName: 'mode', citedValue }]
          })
        ])
      });
    // Bare semantic string in prose, JSON-quoted citedValue (and vice versa): both bind.
    expect(withValue('backoff defaults to `linear`.', '"linear"').errors).toEqual([]);
    expect(withValue('backoff defaults to "linear".', 'linear').errors).toEqual([]);
    // Numeric spellings normalize through Number().
    expect(withValue('the cap is 1_000 ms.', '1000').errors).toEqual([]);
    // A substring is never a binding.
    expect(withValue('backoff is nonlinear.', 'linear').errors).toHaveLength(1);
  });

  it('accepts a citedValue stated only in the predicate (prose paraphrases, predicate is exact)', () => {
    const symbolHash = `ts:${'a'.repeat(64)}`;
    const outcome = validateSubmission({
      mdx: mdxWith('<Claim id="c1">`retries` defaults to 3.</Claim>'),
      ledger: ledgerWith([
        claim('c1', {
          predicate: 'retries defaults to 3',
          proposedSubscriptions: [{ kind: 'cited-value', symbolHash, valueName: 'retries.default', citedValue: '3' }]
        })
      ])
    });
    expect(outcome.errors).toEqual([]);
  });

  it('rejects a ledger claim whose marker is missing from the MDX', () => {
    const outcome = validateSubmission({ mdx: mdxWith('No markers here.'), ledger: ledgerWith([claim('c1')]) });
    expect(outcome.accepted).toBeUndefined();
    expect(outcome.errors[0]).toContain('ledger claim "c1" has no <Claim id="c1"> marker');
  });

  it('treats a literal code example as text: its ledger entry has no marker', () => {
    const outcome = validateSubmission({
      mdx: mdxWith('```mdx\n<Claim id="c1">example</Claim>\n```'),
      ledger: ledgerWith([claim('c1')])
    });
    expect(outcome.accepted).toBeUndefined();
    expect(outcome.errors[0]).toContain('ledger claim "c1" has no <Claim id="c1"> marker');
  });

  it('rejects heading and flow markers in-session with placement repair errors', () => {
    const heading = validateSubmission({
      mdx: mdxWith('body.').replace('# Retry', '# Retry\n\n## <Claim id="c1">Heading claim</Claim>'),
      ledger: ledgerWith([claim('c1')])
    });
    expect(heading.accepted).toBeUndefined();
    expect(heading.errors.some((error) => error.includes('inside a heading'))).toBe(true);

    const flow = validateSubmission({
      mdx: mdxWith('<Claim id="c1">\n  multiline formatted marker.\n</Claim>'),
      ledger: ledgerWith([claim('c1')])
    });
    expect(flow.accepted).toBeUndefined();
    expect(flow.errors.some((error) => error.includes('inline inside the sentence'))).toBe(true);
  });

  it('rejects an orphan marker with no ledger entry', () => {
    const outcome = validateSubmission({
      mdx: mdxWith('<Claim id="c9">something asserted</Claim>'),
      ledger: ledgerWith([])
    });
    expect(outcome.errors[0]).toContain('marker "c9" has no ledger entry');
  });

  it('rejects duplicate marker ids in both the MDX and the ledger', () => {
    const duplicateMarkers = validateSubmission({
      mdx: mdxWith('<Claim id="c1">one</Claim> and <Claim id="c1">two</Claim>'),
      ledger: ledgerWith([claim('c1')])
    });
    expect(duplicateMarkers.errors.some((error) => error.includes('appears 2 times'))).toBe(true);

    const duplicateLedger = validateSubmission({
      mdx: mdxWith('<Claim id="c1">one</Claim>'),
      ledger: ledgerWith([claim('c1'), claim('c1')])
    });
    expect(duplicateLedger.errors.some((error) => error.includes('duplicate markerId'))).toBe(true);
  });

  it('rejects markers that wrap no prose', () => {
    const outcome = validateSubmission({
      mdx: mdxWith('Text <Claim id="c1">   </Claim> more.'),
      ledger: ledgerWith([claim('c1')])
    });
    expect(outcome.accepted).toBeUndefined();
    expect(outcome.errors[0]).toContain('marker "c1" wraps no prose');
  });

  it('rejects kernel-field smuggling with a named-field repair error', () => {
    const outcome = validateSubmission({
      mdx: mdxWith('<Claim id="c1">asserted</Claim>'),
      ledger: ledgerWith([claim('c1', { correctness: 'checked', claimId: 'cl_' + '0'.repeat(20) })])
    });
    expect(outcome.accepted).toBeUndefined();
    const smuggling = outcome.errors.find((error) => error.includes('kernel-owned'));
    expect(smuggling).toContain('"claimId"');
    expect(smuggling).toContain('"correctness"');
  });

  it('reports schema issues with ledger paths', () => {
    const outcome = validateSubmission({
      mdx: mdxWith('<Claim id="c1">asserted</Claim>'),
      ledger: ledgerWith([{ markerId: 'c1', class: 'Value!', predicate: '' }])
    });
    expect(outcome.errors.some((error) => error.startsWith('ledger claims.0.class'))).toBe(true);
    expect(outcome.errors.some((error) => error.startsWith('ledger claims.0.predicate'))).toBe(true);
  });
});

describe('createSubmitPageTool', () => {
  it('holds no result until an accepted call, then serves it via taskResult; last accepted wins', async () => {
    const { tool, accepted } = createSubmitPageTool();
    expect(tool.taskResult?.()).toBeUndefined();

    const rejected = (await tool.handler({ mdx: mdxWith('no markers'), ledger: ledgerWith([claim('c1')]) })) as {
      accepted: boolean;
      errors: string[];
    };
    expect(rejected.accepted).toBe(false);
    expect(rejected.errors.length).toBeGreaterThan(0);
    expect(accepted()).toBeUndefined();

    const first = { mdx: mdxWith('<Claim id="c1">first</Claim>'), ledger: ledgerWith([claim('c1')]) };
    expect(((await tool.handler(first)) as { accepted: boolean }).accepted).toBe(true);
    const second = { mdx: mdxWith('<Claim id="c2">second</Claim>'), ledger: ledgerWith([claim('c2')]) };
    expect(((await tool.handler(second)) as { accepted: boolean }).accepted).toBe(true);

    const result = tool.taskResult?.();
    expect(result?.type).toBe('mdx-ledger');
    expect(result && 'mdx' in result ? result.mdx : '').toContain('c2');
  });
});
