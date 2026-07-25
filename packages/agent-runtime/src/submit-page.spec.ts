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

  it("rejects markers containing MDX expressions — Sol's {'never '} probe (wave 2b close final)", () => {
    // <Claim>greet {'never '}exists.</Claim> renders "greet never exists" but the visible-text
    // scan sees "greet exists" — expressions render text the kernel cannot see, so the marker is
    // invalid outright.
    const probe = scanClaimMarkers('Fact: <Claim id="g1">greet {\'never \'}exists.</Claim>\n');
    expect(probe.errors[0]?.code).toBe('marker-expression');
    expect(probe.errors[0]?.markerId).toBe('g1');
    expect(probe.errors[0]?.message).toContain('cannot');
    expect(probe.markers).toEqual([]);

    // Also caught when the expression hides inside nested inline formatting.
    const nested = scanClaimMarkers('Fact: <Claim id="g2">greet *really {1 + 2}* exists.</Claim>\n');
    expect(nested.errors[0]?.code).toBe('marker-expression');

    // A marker with only literal prose is untouched.
    const clean = scanClaimMarkers('Fact: <Claim id="g3">greet exists.</Claim>\n');
    expect(clean.errors).toEqual([]);
    expect(clean.markers).toHaveLength(1);
  });

  it("rejects markers containing JSX elements — Sol's Badge-with-contradicting-prop probe (wave 2b close final)", () => {
    // <Badge label="greet does not exist.">greet exists.</Badge> scans as 'greet exists.' but
    // renders its prop text — the opposite assertion. Components render arbitrary content, so a
    // marker containing ANY JSX element is invalid outright, not merely uncheckable.
    const badge = scanClaimMarkers(
      'Fact: <Claim id="g1"><Badge label="greet does not exist.">greet exists.</Badge></Claim>\n'
    );
    expect(badge.errors[0]?.code).toBe('marker-jsx');
    expect(badge.errors[0]?.markerId).toBe('g1');
    expect(badge.errors[0]?.message).toContain('JSX element');
    expect(badge.markers).toEqual([]);

    // Also caught when the component hides inside nested inline formatting.
    const nested = scanClaimMarkers('Fact: <Claim id="g2">greet *really <Badge>so</Badge>* exists.</Claim>\n');
    expect(nested.errors[0]?.code).toBe('marker-jsx');
  });

  it("rejects markers carrying any attribute other than id — Sol's set:text probe (wave 2b close final)", () => {
    // <Claim id="g1" set:text="greet does not exist.">greet exists.</Claim> — Astro's set:text
    // directive REPLACES the rendered children with the attribute text, so the reader sees the
    // opposite of the scanned assertion. Whitelist: only the id attribute is legal.
    const probe = scanClaimMarkers('Fact: <Claim id="g1" set:text="greet does not exist.">greet exists.</Claim>\n');
    expect(probe.errors[0]?.code).toBe('marker-attribute');
    expect(probe.errors[0]?.markerId).toBe('g1');
    expect(probe.errors[0]?.message).toContain('accepts only the id attribute');
    expect(probe.markers).toEqual([]);

    const setHtml = scanClaimMarkers('Fact: <Claim id="g2" set:html="<b>lie</b>">greet exists.</Claim>\n');
    expect(setHtml.errors[0]?.code).toBe('marker-attribute');

    // Attribute spreads are rejected the same way — no enumeration, anything but id fails.
    const spread = scanClaimMarkers('Fact: <Claim id="g3" {...props}>greet exists.</Claim>\n');
    expect(spread.errors[0]?.code).toBe('marker-attribute');

    const arbitraryProp = scanClaimMarkers('Fact: <Claim id="g4" className="x">greet exists.</Claim>\n');
    expect(arbitraryProp.errors[0]?.code).toBe('marker-attribute');

    // A plain id-only marker is untouched.
    const clean = scanClaimMarkers('Fact: <Claim id="g5">greet exists.</Claim>\n');
    expect(clean.errors).toEqual([]);
    expect(clean.markers).toHaveLength(1);
  });

  it("rejects duplicate attributes on a marker — Sol's two-id probe (wave 2b close)", () => {
    // <Claim id="a" id="b"> — the scanner would read the FIRST id while JSX rendering uses the
    // LAST, attaching claim "a"'s trust mark to the element rendered as "b". Rejected outright,
    // before any id resolves.
    const twoIds = scanClaimMarkers('Fact: <Claim id="a" id="b">greet exists.</Claim>\n');
    expect(twoIds.errors[0]?.code).toBe('marker-duplicate-attribute');
    expect(twoIds.errors[0]?.message).toContain('"id"');
    expect(twoIds.markers).toEqual([]);

    // Any repeated attribute name is ambiguous, not just id — caught before the whitelist.
    const twoOthers = scanClaimMarkers('Fact: <Claim id="a" data-x="1" data-x="2">greet exists.</Claim>\n');
    expect(twoOthers.errors[0]?.code).toBe('marker-duplicate-attribute');

    // A single id stays untouched.
    const clean = scanClaimMarkers('Fact: <Claim id="a">greet exists.</Claim>\n');
    expect(clean.errors).toEqual([]);
    expect(clean.markers).toHaveLength(1);
  });

  it('rejects raw <script> and <style> elements anywhere in the page (page-script, case-insensitive)', () => {
    // Sibling script/style can rewrite or hide verified claim text after rendering — the theme
    // owns page behavior and styling.
    const flowScript = scanClaimMarkers('Text.\n\n<script>document.body.innerHTML = "lie";</script>\n');
    expect(flowScript.errors[0]?.code).toBe('page-script');
    expect(flowScript.errors[0]?.message).toContain('theme owns page behavior');

    const inlineStyle = scanClaimMarkers('Text with <style>{`.claim { display: none; }`}</style> inline.\n');
    expect(inlineStyle.errors.some((error) => error.code === 'page-script')).toBe(true);

    const upperCase = scanClaimMarkers('Text.\n\n<SCRIPT>alert(1)</SCRIPT>\n');
    expect(upperCase.errors[0]?.code).toBe('page-script');

    const mixedCase = scanClaimMarkers('Text.\n\n<Style>{`p { color: red; }`}</Style>\n');
    expect(mixedCase.errors[0]?.code).toBe('page-script');

    const selfClosing = scanClaimMarkers('Text.\n\n<script src="evil.js" />\n');
    expect(selfClosing.errors[0]?.code).toBe('page-script');
  });

  it('leaves code FENCES and inline code containing <script>/<style> untouched — examples are text, not elements', () => {
    const fence = scanClaimMarkers(
      [
        'Add this snippet:',
        '',
        '```html',
        '<script>console.log("example");</script>',
        '<style>p {}</style>',
        '```'
      ].join('\n')
    );
    expect(fence.errors).toEqual([]);

    const inline = scanClaimMarkers('Never use `<script>` tags, and the word script is fine in prose.\n');
    expect(inline.errors).toEqual([]);
  });

  it('flags marker purity STRUCTURALLY: only text + inlineCode content is pureText (no enumeration)', () => {
    // Pure: plain prose and backticked identifiers — the only nodes whose rendered output
    // provably equals the scanned text.
    const pure = scanClaimMarkers('Fact: <Claim id="p1">`greet` exists.</Claim>\n');
    expect(pure.errors).toEqual([]);
    expect(pure.markers[0]).toMatchObject({ pureText: true, visibleText: 'greet exists.' });

    // Impure but LEGAL MDX (repair-free): emphasis, links, images, footnote references. The
    // visible text still extracts (binding needs it) — checkability is what purity gates.
    const emphasis = scanClaimMarkers('Fact: <Claim id="p2">greet *really* exists.</Claim>\n');
    expect(emphasis.errors).toEqual([]);
    expect(emphasis.markers[0]?.pureText).toBe(false);

    const link = scanClaimMarkers('Fact: <Claim id="p3">[greet exists.](/docs/greet)</Claim>\n');
    expect(link.errors).toEqual([]);
    expect(link.markers[0]?.pureText).toBe(false);

    const image = scanClaimMarkers('Fact: <Claim id="p4">![greet exists.](greet.png)</Claim>\n');
    expect(image.errors).toEqual([]);
    expect(image.markers[0]).toMatchObject({ pureText: false, visibleText: 'greet exists.' });

    const footnote = scanClaimMarkers('Fact: <Claim id="p5">greet exists[^1].</Claim>\n\n[^1]: removed in v3.\n');
    expect(footnote.errors).toEqual([]);
    expect(footnote.markers[0]).toMatchObject({ pureText: false, visibleText: 'greet exists.' });
  });

  it("tracks JSX ancestry: a marker inside ANY component is legal, repair-free — and never pure (Sol's ancestor probe)", () => {
    // <Badge label="greet does not exist."><Claim>greet exists.</Claim></Badge>: the marker's own
    // content is pure text, but Badge's renderer decides whether/how the Claim slot renders — the
    // scan cannot vouch for what the reader sees. Accepted (legal MDX, no repair), pureText false.
    const ancestor = scanClaimMarkers(
      'Status: <Badge label="greet does not exist."><Claim id="a1">`greet` exists.</Claim></Badge>\n'
    );
    expect(ancestor.errors).toEqual([]);
    expect(ancestor.markers[0]).toMatchObject({ markerId: 'a1', pureText: false, visibleText: 'greet exists.' });

    // Any depth of component nesting still counts as a JSX ancestor.
    const deep = scanClaimMarkers(
      'Status: <Wrap><Badge label="no"><Claim id="a2">`greet` exists.</Claim></Badge></Wrap>\n'
    );
    expect(deep.errors).toEqual([]);
    expect(deep.markers[0]).toMatchObject({ markerId: 'a2', pureText: false });

    // A flow-level component ancestor is caught the same way.
    const flow = scanClaimMarkers('<Panel>\n  Fact: <Claim id="a3">`greet` exists.</Claim>\n</Panel>\n');
    expect(flow.errors).toEqual([]);
    expect(flow.markers[0]).toMatchObject({ markerId: 'a3', pureText: false });

    // A sibling component does NOT taint the marker — ancestry, not adjacency, is the condition.
    const sibling = scanClaimMarkers('Fact: <Badge>beta</Badge> and <Claim id="a4">`greet` exists.</Claim>\n');
    expect(sibling.errors).toEqual([]);
    expect(sibling.markers[0]).toMatchObject({ markerId: 'a4', pureText: true });
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

  it('rejects a submission whose marker contains an MDX expression with a repair error', () => {
    const outcome = validateSubmission({
      mdx: mdxWith('<Claim id="c1">greet {\'never \'}exists.</Claim>'),
      ledger: ledgerWith([claim('c1', { class: 'code-structure', predicate: 'greet exists' })])
    });
    expect(outcome.accepted).toBeUndefined();
    expect(outcome.errors.some((error) => error.includes('MDX expression'))).toBe(true);
  });

  it('rejects a submission whose marker contains a JSX component with a repair error', () => {
    const outcome = validateSubmission({
      mdx: mdxWith('<Claim id="c1"><Badge label="greet does not exist.">greet exists.</Badge></Claim>'),
      ledger: ledgerWith([claim('c1', { class: 'code-structure', predicate: 'greet exists' })])
    });
    expect(outcome.accepted).toBeUndefined();
    expect(outcome.errors.some((error) => error.includes('JSX element'))).toBe(true);
  });

  it('rejects a submission whose marker carries an extra attribute with a repair error', () => {
    const outcome = validateSubmission({
      mdx: mdxWith('<Claim id="c1" set:text="greet does not exist.">greet exists.</Claim>'),
      ledger: ledgerWith([claim('c1', { class: 'code-structure', predicate: 'greet exists' })])
    });
    expect(outcome.accepted).toBeUndefined();
    expect(outcome.errors.some((error) => error.includes('accepts only the id attribute'))).toBe(true);
  });

  it('rejects a submission whose marker carries two id attributes with a repair error', () => {
    const outcome = validateSubmission({
      mdx: mdxWith('<Claim id="a" id="b">greet exists.</Claim>'),
      ledger: ledgerWith([claim('a', { class: 'code-structure', predicate: 'greet exists' })])
    });
    expect(outcome.accepted).toBeUndefined();
    expect(outcome.errors.some((error) => error.includes('repeats the attribute') && error.includes('"id"'))).toBe(
      true
    );
  });

  it('rejects a submission carrying raw <script>/<style> elements, but accepts them inside code fences', () => {
    const script = validateSubmission({
      mdx: mdxWith('<Claim id="c1">greet exists.</Claim>\n\n<script>document.title = "x";</script>'),
      ledger: ledgerWith([claim('c1', { class: 'code-structure', predicate: 'greet exists' })])
    });
    expect(script.accepted).toBeUndefined();
    expect(script.errors.some((error) => error.includes('theme owns page behavior'))).toBe(true);

    const style = validateSubmission({
      mdx: mdxWith('<Claim id="c1">greet exists.</Claim>\n\n<style>{`p {}`}</style>'),
      ledger: ledgerWith([claim('c1', { class: 'code-structure', predicate: 'greet exists' })])
    });
    expect(style.accepted).toBeUndefined();
    expect(style.errors.some((error) => error.includes('theme owns page behavior'))).toBe(true);

    // A code fence SHOWING a script tag is documentation, never an element.
    const fenced = validateSubmission({
      mdx: mdxWith('<Claim id="c1">greet exists.</Claim>\n\n```html\n<script>console.log("example");</script>\n```'),
      ledger: ledgerWith([claim('c1', { class: 'code-structure', predicate: 'greet exists' })])
    });
    expect(fenced.errors).toEqual([]);
    expect(fenced.accepted).toBeDefined();
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
