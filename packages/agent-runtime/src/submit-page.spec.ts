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
    // The proposal unions are spelled out, not `{type: object}`. The behavior-execution
    // {kind:'check'} affordance is gone (scope correction — nothing ever consumed it).
    for (const kind of ['symbol', 'file', 'url', 'signature', 'cited-value', 'body', 'file-content']) {
      expect(serialized).toContain(`"${kind}"`);
    }
    expect(serialized).not.toContain('"check"');
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
    // Bidirectional binding: both the marker side and the predicate side fail, precisely.
    expect(outcome.errors).toHaveLength(2);
    expect(outcome.errors.every((error) => error.includes('c1') && error.includes('retries.default'))).toBe(true);
    expect(outcome.errors.some((error) => error.includes('visible marked prose'))).toBe(true);
    expect(outcome.errors.some((error) => error.includes('predicate'))).toBe(true);
  });

  it('binds cited values through the shared normalization: bare, quoted, and numeric spellings agree', () => {
    const symbolHash = `ts:${'a'.repeat(64)}`;
    const withValue = (prose: string, citedValue: string, predicate: string) =>
      validateSubmission({
        mdx: mdxWith(`<Claim id="c1">${prose}</Claim>`),
        ledger: ledgerWith([
          claim('c1', {
            predicate,
            proposedSubscriptions: [{ kind: 'cited-value', symbolHash, valueName: 'mode', citedValue }]
          })
        ])
      });
    // Bare semantic string in prose, JSON-quoted citedValue (and vice versa): both bind.
    expect(withValue('backoff defaults to `linear`.', '"linear"', 'backoff mode defaults to linear').errors).toEqual(
      []
    );
    expect(withValue('backoff defaults to "linear".', 'linear', 'backoff mode defaults to linear').errors).toEqual([]);
    // Numeric spellings normalize through Number().
    expect(withValue('the cap is 1_000 ms.', '1000', 'the cap defaults to 1000').errors).toEqual([]);
    // A substring is never a binding.
    expect(withValue('backoff is nonlinear.', 'linear', 'backoff mode defaults to linear').errors).toHaveLength(1);
  });

  it('REJECTS a citedValue stated only in the predicate — the visible sentence must state it too (impl-07)', () => {
    // The impl-07 must-now-reject case: right predicate, paraphrasing prose. The reader-facing
    // sentence is the claim; a value the reader never sees cannot bind.
    const symbolHash = `ts:${'a'.repeat(64)}`;
    const outcome = validateSubmission({
      mdx: mdxWith('<Claim id="c1">`retries` has a sensible default.</Claim>'),
      ledger: ledgerWith([
        claim('c1', {
          predicate: 'retries defaults to 3',
          proposedSubscriptions: [{ kind: 'cited-value', symbolHash, valueName: 'retries.default', citedValue: '3' }]
        })
      ])
    });
    expect(outcome.accepted).toBeUndefined();
    expect(outcome.errors).toHaveLength(1);
    expect(outcome.errors[0]).toContain('visible marked prose');
  });

  it('binds against RENDERED text only: a value hidden in a link URL never binds (Sol probe)', () => {
    const symbolHash = `ts:${'a'.repeat(64)}`;
    const outcome = validateSubmission({
      mdx: mdxWith('<Claim id="c1">see [the retries docs](/v3/retries) for the default.</Claim>'),
      ledger: ledgerWith([
        claim('c1', {
          predicate: 'retries defaults to 3',
          proposedSubscriptions: [{ kind: 'cited-value', symbolHash, valueName: 'retries.default', citedValue: '3' }]
        })
      ])
    });
    expect(outcome.accepted).toBeUndefined();
    expect(outcome.errors.some((error) => error.includes('visible marked prose'))).toBe(true);
  });

  it('tokenizes numbers lexically: ".5" is 0.5 and identifier-glued digits never bind (Sol probes)', () => {
    const symbolHash = `ts:${'a'.repeat(64)}`;
    const withValue = (prose: string, citedValue: string, predicate: string) =>
      validateSubmission({
        mdx: mdxWith(`<Claim id="c1">${prose}</Claim>`),
        ledger: ledgerWith([
          claim('c1', {
            predicate,
            proposedSubscriptions: [{ kind: 'cited-value', symbolHash, valueName: 'v', citedValue }]
          })
        ])
      });
    // ".5" is the number 0.5, never 5.
    expect(withValue('the factor defaults to .5 exactly.', '5', 'the factor defaults to 5').errors).toHaveLength(1);
    expect(withValue('the factor defaults to .5 exactly.', '0.5', 'the factor defaults to 0.5').errors).toEqual([]);
    // "3" inside "retry3" is an identifier, not the number 3.
    expect(withValue('call `retry3` to retry.', '3', 'retries defaults to 3').errors).toHaveLength(1);
  });

  it('rejects conflicting or negated values in the visible prose with a repair error', () => {
    const symbolHash = `ts:${'a'.repeat(64)}`;
    const withProse = (prose: string) =>
      validateSubmission({
        mdx: mdxWith(`<Claim id="c1">${prose}</Claim>`),
        ledger: ledgerWith([
          claim('c1', {
            predicate: 'retries defaults to 3',
            proposedSubscriptions: [{ kind: 'cited-value', symbolHash, valueName: 'retries.default', citedValue: '3' }]
          })
        ])
      });
    // "5, not 3": multiple distinct candidates AND explicit negation — both named.
    const negated = withProse('`retries` defaults to 5, not 3.');
    expect(negated.accepted).toBeUndefined();
    expect(negated.errors.some((error) => error.includes('ONE unambiguous value'))).toBe(true);
    expect(negated.errors.some((error) => error.includes('NEGATES'))).toBe(true);
    // Two distinct numbers without negation still cannot bind unambiguously.
    const conflicted = withProse('`retries` defaults to 3 within 15 seconds.');
    expect(conflicted.accepted).toBeUndefined();
    expect(conflicted.errors).toHaveLength(1);
    expect(conflicted.errors[0]).toContain('ONE unambiguous value');
  });

  it('TYPED binding, Sol\'s impl-08 probe: numeric 3 must NOT bind prose stating the string "3"', () => {
    const symbolHash = `ts:${'a'.repeat(64)}`;
    const outcome = validateSubmission({
      mdx: mdxWith('<Claim id="c1">`mode` defaults to "3" (a string).</Claim>'),
      ledger: ledgerWith([
        claim('c1', {
          predicate: 'the mode option defaults to 3',
          proposedSubscriptions: [{ kind: 'cited-value', symbolHash, valueName: 'mode.default', citedValue: '3' }]
        })
      ])
    });
    expect(outcome.accepted).toBeUndefined();
    expect(outcome.errors.some((error) => error.includes('visible marked prose'))).toBe(true);
  });

  it('TYPED binding, vice versa: the string "3" binds quoted prose but never a bare numeric token', () => {
    const symbolHash = `ts:${'a'.repeat(64)}`;
    const withProse = (prose: string, predicate: string) =>
      validateSubmission({
        mdx: mdxWith(`<Claim id="c1">${prose}</Claim>`),
        ledger: ledgerWith([
          claim('c1', {
            predicate,
            proposedSubscriptions: [{ kind: 'cited-value', symbolHash, valueName: 'mode.default', citedValue: '"3"' }]
          })
        ])
      });
    expect(
      withProse('`mode` defaults to "3" (a string).', 'the mode option defaults to the string "3"').errors
    ).toEqual([]);
    const bare = withProse('`mode` defaults to 3.', 'the mode option defaults to 3');
    expect(bare.accepted).toBeUndefined();
    expect(bare.errors).toHaveLength(2);
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
