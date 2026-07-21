import { describe, expect, it } from 'vitest';
import { createSubmitPageTool, scanClaimMarkers, validateSubmission } from './submit-page.ts';

const mdxWith = (body: string): string => `---\ntitle: "Retry"\n---\n\n# Retry\n\n${body}\n`;

const ledgerWith = (claims: unknown[]): unknown => ({ schemaVersion: 1, claims });

const claim = (markerId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  markerId,
  class: 'value',
  predicate: 'retries defaults to 3',
  ...overrides
});

describe('scanClaimMarkers', () => {
  it('finds markers with offsets and inner MDX', () => {
    const mdx = 'Intro. <Claim id="c1">`retries` defaults to 3.</Claim> Outro.';
    const scan = scanClaimMarkers(mdx);
    expect(scan.errors).toEqual([]);
    expect(scan.markers).toHaveLength(1);
    expect(scan.markers[0]).toMatchObject({ markerId: 'c1', innerMdx: '`retries` defaults to 3.' });
    expect(mdx.slice(scan.markers[0]!.offset)).toMatch(/^<Claim id="c1">/);
  });

  it('reports self-closing, unclosed, nested, stray-close, and missing-id markers precisely', () => {
    expect(scanClaimMarkers('<Claim id="a"/>').errors[0]).toContain('self-closing');
    expect(scanClaimMarkers('<Claim id="a">text').errors[0]).toContain('never closed');
    expect(scanClaimMarkers('<Claim id="a">x <Claim id="b">y</Claim></Claim>').errors[0]).toContain('must not nest');
    expect(scanClaimMarkers('text</Claim>').errors[0]).toContain('stray </Claim>');
    expect(scanClaimMarkers('<Claim>text</Claim>').errors[0]).toContain('no id attribute');
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

  it('rejects a ledger claim whose marker is missing from the MDX', () => {
    const outcome = validateSubmission({ mdx: mdxWith('No markers here.'), ledger: ledgerWith([claim('c1')]) });
    expect(outcome.accepted).toBeUndefined();
    expect(outcome.errors[0]).toContain('ledger claim "c1" has no <Claim id="c1"> marker');
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
      mdx: mdxWith('<Claim id="c1">   </Claim>'),
      ledger: ledgerWith([claim('c1')])
    });
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
