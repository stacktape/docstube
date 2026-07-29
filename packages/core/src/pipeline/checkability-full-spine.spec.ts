import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { evaluateSubmitPageCall } from '@docstube/agent-runtime';
import type { ElementPolicy } from '@docstube/agent-runtime';
import { typescriptLanguagePack } from '@docstube/lang-typescript';
import {
  codemapSchema,
  fingerprintSnapshotSchema,
  pageShardSchema,
  provenanceV2Schema,
  sha256Hex,
  writerClaimLedgerSchema
} from '@docstube/contracts';
import type { Codemap, FingerprintSnapshot, ObservedRead, PageShard, WriterClaimLedger } from '@docstube/contracts';
import { extractPageEntity } from '../entities/extract-entities.ts';
import { anchorWriterLedger } from './anchor-ledger.ts';
import { verifyClaims } from './verify-claims.ts';

// THE FULL-SPINE PROBES, as permanent e2e tests (impl-12, hardened to exact canonical visible
// match in impl-13). Sol's bypass class: visible prose the cue detectors never listed ("`greet`
// is absent.", "`greet` returns the value.", "`greet` 不存在.", "`greet` is exported from
// `fiction`.") riding REAL evidence through submit → anchor → verify to reach the reader as 1/1
// CHECKED. Under exact canonical visible match every one of these spines must end with the
// persisted shard carrying the claim as UNCHECKED (0 of 1 checked) — the reader projection is
// literal over ClaimEvidence (theme proof-projection.spec proves that side), so a shard that
// never says 'checked' can never render 1/1. Canonical positives keep minting checked end to
// end, and canonical lies keep minting contradicted.

const COMMIT = 'b'.repeat(40);
const GREET_SYMBOL = `ts:${'7'.repeat(64)}`;
const MODE_SYMBOL = `ts:${'6'.repeat(64)}`;
const HIDDEN_SYMBOL = `ts:${'5'.repeat(64)}`;
const NESTED_SYMBOL = `ts:${'4'.repeat(64)}`;
// The live configuration-page shape (impl-15 finding 2): a value the writer phrases perfectly but
// has no symbol hash for, so it can only propose a whole-file dependency.
const CONFIG_SYMBOL = `ts:${'3'.repeat(64)}`;
const PRINT = '8'.repeat(64);
const READ_HASH = '9'.repeat(64);

const fingerprints: FingerprintSnapshot = fingerprintSnapshotSchema.parse({
  schemaVersion: 1,
  commit: COMMIT,
  symbols: [
    { symbolHash: GREET_SYMBOL, signaturePrint: PRINT, valuePrints: {}, bodyPrint: PRINT },
    { symbolHash: MODE_SYMBOL, signaturePrint: PRINT, valuePrints: { MODE: sha256Hex('"linear"') }, bodyPrint: PRINT },
    { symbolHash: HIDDEN_SYMBOL, signaturePrint: PRINT, valuePrints: {}, bodyPrint: PRINT },
    {
      symbolHash: NESTED_SYMBOL,
      signaturePrint: PRINT,
      valuePrints: { 'retryDefaults.backoff.factor': sha256Hex('2') },
      bodyPrint: PRINT
    },
    {
      symbolHash: CONFIG_SYMBOL,
      signaturePrint: PRINT,
      valuePrints: { 'configFileNames.config': sha256Hex('"docstube.yml"') },
      bodyPrint: PRINT
    }
  ],
  unparsedFiles: []
});

const codemap: Codemap = codemapSchema.parse({
  schemaVersion: 1,
  commit: COMMIT,
  symbols: [
    // greet affirms exportedness the way the built-in packs do ('public'); hidden affirms the
    // opposite; MODE/retryDefaults state none (existence/value forms never need it).
    {
      hash: GREET_SYMBOL,
      lang: 'ts',
      kind: 'function',
      name: 'greet',
      file: 'src/greet.ts',
      span: [1, 3],
      visibility: 'public'
    },
    { hash: MODE_SYMBOL, lang: 'ts', kind: 'variable', name: 'MODE', file: 'src/mode.ts', span: [1, 1] },
    {
      hash: HIDDEN_SYMBOL,
      lang: 'ts',
      kind: 'function',
      name: 'hidden',
      file: 'src/greet.ts',
      span: [5, 7],
      visibility: 'private'
    },
    {
      hash: NESTED_SYMBOL,
      lang: 'ts',
      kind: 'variable',
      name: 'retryDefaults',
      file: 'src/mode.ts',
      span: [2, 2]
    },
    {
      hash: CONFIG_SYMBOL,
      lang: 'ts',
      kind: 'variable',
      name: 'configFileNames',
      file: 'src/config.ts',
      span: [1, 1]
    }
  ]
});

const observedReads: ObservedRead[] = [
  { file: 'src/greet.ts', contentHash: READ_HASH },
  { file: 'src/mode.ts', contentHash: READ_HASH },
  { file: 'src/config.ts', contentHash: READ_HASH }
];

let repoRoot: string;

beforeAll(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'docstube-full-spine-'));
  await mkdir(join(repoRoot, 'src'), { recursive: true });
  await writeFile(
    join(repoRoot, 'src', 'mode.ts'),
    "export const MODE = 'linear';\nexport const retryDefaults = { backoff: { factor: 2 } };\n"
  );
  await writeFile(join(repoRoot, 'src', 'config.ts'), "export const configFileNames = { config: 'docstube.yml' };\n");
});

afterAll(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

const pageMdx = (claimProse: string, extraMdx = ''): string => `---
title: "Greet"
---

# Greet

<Claim id="g1">${claimProse}</Claim>
${extraMdx}`;

const existenceLedger = (predicate: string, symbol = GREET_SYMBOL): WriterClaimLedger =>
  writerClaimLedgerSchema.parse({
    schemaVersion: 1,
    claims: [
      {
        markerId: 'g1',
        class: 'code-structure',
        predicate,
        proposedEvidence: [{ kind: 'symbol', symbol }],
        proposedSubscriptions: [{ kind: 'signature', symbolHash: symbol }]
      }
    ]
  });

const valueLedger = (
  predicate: string,
  citedValue: string,
  symbol = MODE_SYMBOL,
  valueName = 'MODE'
): WriterClaimLedger =>
  writerClaimLedgerSchema.parse({
    schemaVersion: 1,
    claims: [
      {
        markerId: 'g1',
        class: 'value',
        predicate,
        proposedEvidence: [{ kind: 'symbol', symbol }],
        proposedSubscriptions: [{ kind: 'cited-value', symbolHash: symbol, valueName, citedValue }]
      }
    ]
  });

// The LIVE writer shape the kernel must now rescue (impl-15 finding 2): a canonically phrased
// value claim whose only proposal is the conservative whole-file dependency, because proposing a
// cited-value subscription would have needed a symbol hash the writer never saw.
const hashlessValueLedger = (predicate: string, file = 'src/config.ts'): WriterClaimLedger =>
  writerClaimLedgerSchema.parse({
    schemaVersion: 1,
    claims: [
      {
        markerId: 'g1',
        class: 'value',
        predicate,
        proposedEvidence: [{ kind: 'file', file }],
        proposedSubscriptions: [{ kind: 'file-content', file }]
      }
    ]
  });

// The project's registered components for these probes — the SAME policy submit_page validates
// with and the kernel re-scans with, so an element error post-acceptance means altered MDX.
const registry: ElementPolicy = { allowedComponents: ['Badge'] };

// The spine: submit_page validation → kernel anchoring → claim verification → persisted shard.
const runSpineWithMdx = async (mdx: string, ledger: WriterClaimLedger) => {
  // 1. submit_page ACCEPTS — the writer-side gate cannot catch lexical bypasses; the exact
  //    canonical visible match is the evidence-decision backstop, not an in-session repair.
  const submission = evaluateSubmitPageCall({ mdx, ledger }, registry);
  expect(submission.response.accepted).toBe(true);

  // 2. Kernel anchoring accepts (subject bound, polarity agreed — the probes use exactly the
  //    vocabulary the cue detectors never listed).
  const page = extractPageEntity({ mdx, slug: 'greet' });
  const anchored = anchorWriterLedger({
    mdx,
    writerLedger: ledger,
    page,
    fingerprints,
    codemap,
    observedReads,
    commit: COMMIT,
    elementPolicy: registry
  });
  if (!anchored.ok) {
    throw new Error(`anchoring failed: ${anchored.errors.map((issue) => issue.message).join('; ')}`);
  }

  // 3. Claim verification — the enforcement point.
  const verified = await verifyClaims({
    ledger: anchored.ledger,
    anchored: anchored.anchored,
    anchorEvidence: anchored.evidence,
    rejectedProposals: anchored.rejectedProposals,
    codemap,
    packs: [typescriptLanguagePack],
    repoRoot,
    fingerprints,
    commit: COMMIT
  });

  // 4. The persisted shard — the exact record every reader surface projects from.
  const shard: PageShard = pageShardSchema.parse({
    schemaVersion: 2,
    locale: 'en',
    version: 'latest',
    sourceCommit: COMMIT,
    generatedAt: new Date().toISOString(),
    page,
    ledger: verified.ledger,
    provenance: provenanceV2Schema.parse({ schemaVersion: 1, claimEvidence: verified.claimEvidence }),
    flags: []
  });
  return { anchored, verified, shard };
};

const runSpine = async (claimProse: string, ledger: WriterClaimLedger, extraMdx = '') =>
  runSpineWithMdx(pageMdx(claimProse, extraMdx), ledger);

const expectUnchecked = (spine: Awaited<ReturnType<typeof runSpine>>): void => {
  expect(spine.verified.findings).toEqual([]);
  const records = spine.shard.provenance?.claimEvidence ?? [];
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ correctness: 'unchecked', disposition: 'no-checker-available' });
  expect(records[0]?.decidingEvidenceId).toBeUndefined();
  expect(records.filter((record) => record.correctness === 'checked')).toHaveLength(0);
  expect(spine.shard.ledger?.claims[0]).toMatchObject({
    correctness: 'unchecked',
    disposition: 'no-checker-available'
  });
};

describe('full-spine probes: submit → anchor → verify → shard', () => {
  it("'`greet` is absent.' over predicate 'greet exists' persists UNCHECKED — the reader can never see 1/1 checked", async () => {
    const spine = await runSpine('`greet` is absent.', existenceLedger('greet exists'));

    // Anchoring journaled the non-blocking destined-unchecked hint (phrasing improvement is
    // opportunistic, never a repair spiral).
    expect(spine.anchored.warnings.some((warning) => warning.includes('destined to ship UNCHECKED'))).toBe(true);
    expect(spine.verified.warnings.some((warning) => warning.includes('CANONICAL CHECKABLE GRAMMAR'))).toBe(true);
    expectUnchecked(spine);
    const records = spine.shard.provenance?.claimEvidence ?? [];
    expect(records[0]?.evidence.every((record) => record.ref.kind !== 'codemap-grounding')).toBe(true);
  });

  it("Sol's verdict-3 probe: '`greet` returns the value.' over predicate 'greet exists' persists UNCHECKED", async () => {
    // The hidden predicate is canonical, but the reader sees a behavior sentence — the visible
    // text must BE the canonical assertion, not merely ride alongside one.
    const spine = await runSpine('`greet` returns the value.', existenceLedger('greet exists'));
    expect(spine.verified.warnings.some((warning) => warning.includes('CANONICAL CHECKABLE GRAMMAR'))).toBe(true);
    expectUnchecked(spine);
  });

  it("Sol's verdict-3 probe: '`greet` is exported from `fiction`.' persists UNCHECKED — the from-variant is removed", async () => {
    const spine = await runSpine(
      '`greet` is exported from `fiction`.',
      existenceLedger('greet is exported from fiction')
    );
    expect(spine.verified.warnings.some((warning) => warning.includes('CANONICAL CHECKABLE GRAMMAR'))).toBe(true);
    expectUnchecked(spine);
  });

  it("Sol's non-Latin probe: '`greet` 不存在.' persists UNCHECKED", async () => {
    const spine = await runSpine('`greet` 不存在.', existenceLedger('greet exists'));
    expect(spine.verified.warnings.some((warning) => warning.includes('CANONICAL CHECKABLE GRAMMAR'))).toBe(true);
    expectUnchecked(spine);
  });

  it("Sol's distant-clause probe: '`greet`, which recently ceased to exist, exists.' persists UNCHECKED", async () => {
    const spine = await runSpine('`greet`, which recently ceased to exist, exists.', existenceLedger('greet exists'));
    expect(spine.verified.warnings.some((warning) => warning.includes('CANONICAL CHECKABLE GRAMMAR'))).toBe(true);
    expectUnchecked(spine);
  });

  it("the long-filler variant ('… that is not defined') persists UNCHECKED too", async () => {
    const spine = await runSpine(
      '`greet` is available as the value of the option of the key that is not defined.',
      existenceLedger('greet exists')
    );
    expect(spine.verified.warnings.some((warning) => warning.includes('CANONICAL CHECKABLE GRAMMAR'))).toBe(true);
    expectUnchecked(spine);
  });

  it("Sol's verdict-3 probe: '`MODE` returns linear.' with constant evidence persists UNCHECKED — never checked or contradicted", async () => {
    // Behavior prose can never reach value evidence: the comparison is skipped entirely, so even
    // an extraction equal to the asserted spelling mints nothing in either direction.
    const spine = await runSpine('`MODE` returns linear.', valueLedger('MODE returns linear', 'linear'));
    expectUnchecked(spine);
    const records = spine.shard.provenance?.claimEvidence ?? [];
    expect(records[0]?.evidence.every((record) => record.ref.kind !== 'value-predicate')).toBe(true);
    expect(records.filter((record) => record.correctness === 'contradicted')).toHaveLength(0);
  });

  it("the canonical positive '`greet` exists.' still mints CHECKED end to end", async () => {
    const { anchored, verified, shard } = await runSpine('`greet` exists.', existenceLedger('greet exists'));
    expect(anchored.warnings).toEqual([]);
    expect(verified.findings).toEqual([]);
    const record = shard.provenance?.claimEvidence[0];
    expect(record).toMatchObject({ correctness: 'checked', disposition: null });
    const deciding = record?.evidence.find((entry) => entry.evidenceId === record.decidingEvidenceId);
    expect(deciding?.ref).toMatchObject({ kind: 'codemap-grounding', symbol: GREET_SYMBOL, file: 'src/greet.ts' });
    expect(shard.ledger?.claims[0]).toMatchObject({ correctness: 'checked', disposition: null });
  });

  it("the canonical value positive '`MODE` defaults to linear.' still mints CHECKED end to end", async () => {
    const { verified, shard } = await runSpine(
      '`MODE` defaults to linear.',
      valueLedger('MODE defaults to linear', 'linear')
    );
    expect(verified.findings).toEqual([]);
    const record = shard.provenance?.claimEvidence[0];
    expect(record).toMatchObject({ correctness: 'checked', disposition: null });
    const deciding = record?.evidence.find((entry) => entry.evidenceId === record.decidingEvidenceId);
    expect(deciding?.ref).toMatchObject({
      kind: 'value-predicate',
      assertedValue: '"linear"',
      extractedValue: '"linear"'
    });
  });

  it("Sol's escaped-backtick probe: '`greet` ex\\`ists.' persists UNCHECKED — a literal backtick is content", async () => {
    // The MDX escape \` renders a LITERAL backtick: the reader sees 'greet ex`ists.'. The old
    // normalizer deleted backticks and minted checked; backticks are no longer cosmetic.
    const spine = await runSpine('`greet` ex\\`ists.', existenceLedger('greet exists'));
    expect(spine.verified.warnings.some((warning) => warning.includes('CANONICAL CHECKABLE GRAMMAR'))).toBe(true);
    expectUnchecked(spine);
  });

  it("Sol's expression probe: <Claim>greet {'never '}exists.</Claim> is REJECTED at submit_page — the spine never starts", () => {
    // The expression renders 'greet never exists' while the scan sees 'greet exists' — the exact
    // laundering channel; markers containing MDX expressions are invalid outright.
    const submission = evaluateSubmitPageCall({
      mdx: pageMdx("greet {'never '}exists."),
      ledger: existenceLedger('greet exists')
    });
    expect(submission.response.accepted).toBe(false);
    expect(submission.response.errors?.some((error) => error.includes('MDX expression'))).toBe(true);
  });

  it("Sol's verdict-5 Badge probe: a JSX component inside the marker is REJECTED at submit_page — the spine never starts", () => {
    // <Badge label="greet does not exist.">greet exists.</Badge> scans as 'greet exists.' but
    // renders the contradicting prop text — components render arbitrary content, so markers
    // containing ANY JSX element are invalid outright (marker-jsx).
    const submission = evaluateSubmitPageCall({
      mdx: pageMdx('<Badge label="greet does not exist.">greet exists.</Badge>'),
      ledger: existenceLedger('greet exists')
    });
    expect(submission.response.accepted).toBe(false);
    expect(submission.response.errors?.some((error) => error.includes('JSX element'))).toBe(true);
  });

  it('Sol\'s verdict-7 probe: <Claim id="g1" set:text="…">greet exists.</Claim> is REJECTED at submit_page — the spine never reaches anchoring', () => {
    // Astro's set:text directive replaces the rendered children with the attribute text, so the
    // reader would see "greet does not exist." while the kernel checked "greet exists." —
    // <Claim> accepts only the id attribute; anything else is rejected in-session.
    const mdx = `---
title: "Greet"
---

# Greet

Fact: <Claim id="g1" set:text="greet does not exist.">\`greet\` exists.</Claim>
`;
    const submission = evaluateSubmitPageCall({ mdx, ledger: existenceLedger('greet exists') });
    expect(submission.response.accepted).toBe(false);
    expect(submission.response.errors?.some((error) => error.includes('accepts only the id attribute'))).toBe(true);
  });

  it('Sol\'s two-id probe: <Claim id="a" id="b"> is REJECTED at submit_page — the spine never reaches anchoring', () => {
    // The scanner would read the first id while JSX rendering uses the last — the trust mark
    // would attach to the wrong claim. Duplicate attributes are rejected in-session.
    const submission = evaluateSubmitPageCall({
      mdx: `---
title: "Greet"
---

# Greet

Fact: <Claim id="g1" id="g2">\`greet\` exists.</Claim>
`,
      ledger: existenceLedger('greet exists')
    });
    expect(submission.response.accepted).toBe(false);
    expect(submission.response.errors?.some((error) => error.includes('repeats the attribute'))).toBe(true);
  });

  it("Sol's sibling-script probe: a raw <script> element is REJECTED at submit_page — the spine never reaches anchoring", () => {
    // A sibling script can rewrite the verified claim text after rendering; the theme owns page
    // behavior. Rejected in-session with the page-script repair error.
    const submission = evaluateSubmitPageCall({
      mdx: pageMdx('`greet` exists.', '\n<script>document.body.innerHTML = "greet does not exist.";</script>\n'),
      ledger: existenceLedger('greet exists')
    });
    expect(submission.response.accepted).toBe(false);
    expect(submission.response.errors?.some((error) => error.includes('theme owns page behavior'))).toBe(true);

    const style = evaluateSubmitPageCall({
      mdx: pageMdx('`greet` exists.', '\n<style>{`[data-docstube-claim] { display: none; }`}</style>\n'),
      ledger: existenceLedger('greet exists')
    });
    expect(style.response.accepted).toBe(false);
    expect(style.response.errors?.some((error) => error.includes('theme owns page behavior'))).toBe(true);
  });

  it('Sol\'s counterfeit-chip probe: a raw <div class="dt-…"> sibling is REJECTED at submit_page — the spine never starts', () => {
    // Only REGISTERED components may be authored. A raw HTML sibling can paint proof chrome the
    // kernel never issued (and restyle or hide the checked prose), so it is refused structurally —
    // no attribute deny-list involved, and no uppercase or quoted-'>' spelling escapes it.
    const submission = evaluateSubmitPageCall(
      {
        mdx: pageMdx('`greet` exists.', '\n<div title="a > b" CLASS="dt-claims--complete">1 of 1 checked</div>\n'),
        ledger: existenceLedger('greet exists')
      },
      registry
    );
    expect(submission.response.accepted).toBe(false);
    expect(submission.response.errors?.some((error) => error.includes('the theme owns presentation'))).toBe(true);

    // An unregistered component and a non-literal prop are refused the same way.
    const unregistered = evaluateSubmitPageCall(
      { mdx: pageMdx('`greet` exists.', '\n<Sneaky {...handlerProps} />\n'), ledger: existenceLedger('greet exists') },
      registry
    );
    expect(unregistered.response.accepted).toBe(false);
    expect(unregistered.response.errors?.some((error) => error.includes('is not a registered component'))).toBe(true);
    expect(unregistered.response.errors?.some((error) => error.includes('plain string literal'))).toBe(true);
  });

  it("Sol's MDX-ESM probe: an export default component is REJECTED at submit_page — the spine never starts", () => {
    // THE THIRD EXECUTABLE NODE KIND: `export default function Evil(){ return <script>…</script> }`
    // produces neither an element node (for the whitelist) nor an expression node (for the
    // expression rule), and MDX compiles it into the page's OWN rendered wrapper — so the page
    // shipped executable, claim-rewriting markup while both gates saw a clean AST.
    const exportDefault = evaluateSubmitPageCall(
      {
        mdx: pageMdx(
          '`greet` exists.',
          '\nexport default function Evil() { return <script>document.body.innerHTML = "greet does not exist.";</script> }\n'
        ),
        ledger: existenceLedger('greet exists')
      },
      registry
    );
    expect(exportDefault.response.accepted).toBe(false);
    expect(exportDefault.response.errors?.some((error) => error.includes('import/export statement'))).toBe(true);

    for (const statement of ["import Evil from './evil.tsx'", 'export const a = 1']) {
      const submission = evaluateSubmitPageCall(
        { mdx: pageMdx('`greet` exists.', `\n${statement}\n`), ledger: existenceLedger('greet exists') },
        registry
      );
      expect(submission.response.accepted).toBe(false);
      expect(submission.response.errors?.some((error) => error.includes('import/export statement'))).toBe(true);
    }
  });

  it("Sol's tokenizer probe: tag-shaped content in a string PROP is REJECTED at submit_page", () => {
    // `<img title='>' ONERROR=alert(1)>` ends the tag early for every `[^>]*` regex while HTML
    // keeps parsing attributes, and `<img/onError=…>` needs no whitespace at all. Props carry
    // plain text, so the shape is refused instead of parsed.
    for (const payload of ["<img title='>' ONERROR=alert(1)>", '<img/onError=alert(1)>']) {
      const submission = evaluateSubmitPageCall(
        {
          mdx: pageMdx('`greet` exists.', `\n<Badge label="${payload}">beta</Badge>\n`),
          ledger: existenceLedger('greet exists')
        },
        registry
      );
      expect(submission.response.accepted).toBe(false);
      expect(submission.response.errors?.some((error) => error.includes('component props carry PLAIN TEXT'))).toBe(
        true
      );
    }

    // A less-than sign in ordinary prop text stays legal — the boundary is `<` immediately
    // followed by a letter or "/".
    const lessThan = evaluateSubmitPageCall(
      {
        mdx: pageMdx('`greet` exists.', '\n<Badge label="latency < 5ms">fast</Badge>\n'),
        ledger: existenceLedger('greet exists')
      },
      registry
    );
    expect(lessThan.response.accepted).toBe(true);
  });

  it('a code FENCE showing <script> markup is documentation, not an element — the canonical spine still mints CHECKED', async () => {
    const fence = '\n```html\n<script>console.log("example");</script>\n<style>p {}</style>\n```\n';
    const { verified, shard } = await runSpine('`greet` exists.', existenceLedger('greet exists'), fence);
    expect(verified.findings).toEqual([]);
    expect(shard.provenance?.claimEvidence[0]).toMatchObject({ correctness: 'checked', disposition: null });
  });

  it('Sol\'s verdict-6 ancestor probe: <Badge label="greet does not exist."><Claim>greet exists.</Claim></Badge> persists UNCHECKED — never checked', async () => {
    // The marker's own content is the exact canonical assertion, but Badge's renderer owns the
    // Claim slot — it can render its contradicting label instead. NO-JSX-ANCESTOR checkability:
    // the marker scans pureText: false, so no evidence may ever decide the claim. Legal MDX,
    // repair-free, accepted end to end — permanently unchecked, never 1/1 checked.
    const mdx = `---
title: "Greet"
---

# Greet

Status: <Badge label="greet does not exist."><Claim id="g1">\`greet\` exists.</Claim></Badge>
`;
    const spine = await runSpineWithMdx(mdx, existenceLedger('greet exists'));
    expect(spine.anchored.warnings.some((warning) => warning.includes('destined to ship UNCHECKED'))).toBe(true);
    expect(spine.verified.warnings.some((warning) => warning.includes('CANONICAL CHECKABLE GRAMMAR'))).toBe(true);
    expectUnchecked(spine);
    const records = spine.shard.provenance?.claimEvidence ?? [];
    expect(records[0]?.evidence.every((record) => record.ref.kind !== 'codemap-grounding')).toBe(true);
  });

  it("Sol's verdict-5 image-alt probe: '![greet exists.](greet.png)' persists UNCHECKED — alt text scans but renders as a picture", async () => {
    // The scanned visible text is exactly the canonical assertion, but the marker is NOT pure
    // text + inline code: what the reader sees (an image) is not what the scan vouched for. The
    // pure-marker precondition refuses checkability before any grammar — unchecked end to end.
    const spine = await runSpine('![greet exists.](greet.png)', existenceLedger('greet exists'));
    expect(spine.anchored.warnings.some((warning) => warning.includes('destined to ship UNCHECKED'))).toBe(true);
    expect(spine.verified.warnings.some((warning) => warning.includes('CANONICAL CHECKABLE GRAMMAR'))).toBe(true);
    expectUnchecked(spine);
    const records = spine.shard.provenance?.claimEvidence ?? [];
    expect(records[0]?.evidence.every((record) => record.ref.kind !== 'codemap-grounding')).toBe(true);
  });

  it("Sol's verdict-5 footnote probe: 'greet exists[^1].' persists UNCHECKED — the reference renders content the scan cannot see", async () => {
    const spine = await runSpine('`greet` exists[^1].', existenceLedger('greet exists'), '\n[^1]: removed in v3.\n');
    expect(spine.verified.warnings.some((warning) => warning.includes('CANONICAL CHECKABLE GRAMMAR'))).toBe(true);
    expectUnchecked(spine);
    const records = spine.shard.provenance?.claimEvidence ?? [];
    expect(records[0]?.evidence.every((record) => record.ref.kind !== 'codemap-grounding')).toBe(true);
  });

  it('the pure-marker gate also blocks value evidence: an image-alt canonical value assertion persists UNCHECKED', async () => {
    const spine = await runSpine(
      '![MODE defaults to linear.](mode.png)',
      valueLedger('MODE defaults to linear', 'linear')
    );
    expectUnchecked(spine);
    const records = spine.shard.provenance?.claimEvidence ?? [];
    expect(records[0]?.evidence.every((record) => record.ref.kind !== 'value-predicate')).toBe(true);
  });

  it("Sol's root-substitution probe: '`retryDefaults` is 2.' against the nested leaf persists UNCHECKED", async () => {
    const spine = await runSpine(
      '`retryDefaults` is 2.',
      valueLedger('retryDefaults is 2', '2', NESTED_SYMBOL, 'retryDefaults.backoff.factor')
    );
    expect(spine.verified.warnings.some((warning) => warning.includes('CANONICAL CHECKABLE GRAMMAR'))).toBe(true);
    expectUnchecked(spine);
    const records = spine.shard.provenance?.claimEvidence ?? [];
    expect(records[0]?.evidence.every((record) => record.ref.kind !== 'value-predicate')).toBe(true);
  });

  it("the FULL value path '`retryDefaults.backoff.factor` is 2.' still mints CHECKED end to end", async () => {
    const { verified, shard } = await runSpine(
      '`retryDefaults.backoff.factor` is 2.',
      valueLedger('retryDefaults.backoff.factor is 2', '2', NESTED_SYMBOL, 'retryDefaults.backoff.factor')
    );
    expect(verified.findings).toEqual([]);
    const record = shard.provenance?.claimEvidence[0];
    expect(record).toMatchObject({ correctness: 'checked', disposition: null });
    const deciding = record?.evidence.find((entry) => entry.evidenceId === record.decidingEvidenceId);
    expect(deciding?.ref).toMatchObject({ kind: 'value-predicate', assertedValue: '2', extractedValue: '2' });
  });

  // KERNEL CITED-VALUE RESOLUTION (impl-15 finding 2). The live run's configuration page emitted
  // claims in perfect canonical form and shipped every one of them unchecked, because a
  // cited-value subscription needs a SYMBOL HASH the writer does not have. The value was always
  // extractable; only the wiring was missing.
  it("the live shape: '`configFileNames.config` is docstube.yml.' with only a whole-file proposal mints CHECKED end to end", async () => {
    const { anchored, verified, shard } = await runSpine(
      '`configFileNames.config` is docstube.yml.',
      hashlessValueLedger('configFileNames.config is docstube.yml')
    );
    expect(anchored.warnings.some((warning) => warning.includes('kernel resolved the cited value'))).toBe(true);
    expect(verified.findings).toEqual([]);
    const record = shard.provenance?.claimEvidence[0];
    expect(record).toMatchObject({ correctness: 'checked', disposition: null });
    const deciding = record?.evidence.find((entry) => entry.evidenceId === record.decidingEvidenceId);
    expect(deciding?.ref).toMatchObject({
      kind: 'value-predicate',
      symbol: CONFIG_SYMBOL,
      valueName: 'configFileNames.config',
      assertedValue: '"docstube.yml"',
      extractedValue: '"docstube.yml"'
    });
    // The kernel-minted subscription rides the committed ledger — the whole-file dependency stays
    // alongside it, so the claim is never LESS invalidated than before.
    expect(shard.ledger?.claims[0]?.subscriptions).toEqual([
      { kind: 'file-content', file: 'src/config.ts', contentHash: READ_HASH },
      {
        kind: 'cited-value',
        symbolHash: CONFIG_SYMBOL,
        valueName: 'configFileNames.config',
        citedValue: '"docstube.yml"'
      }
    ]);
  });

  it('a kernel-resolved value that the docs got WRONG mints CONTRADICTED end to end — a caught lie, gating', async () => {
    const { verified, shard } = await runSpine(
      '`configFileNames.config` is docstube.yaml.',
      hashlessValueLedger('configFileNames.config is docstube.yaml')
    );
    expect(verified.findings).toHaveLength(1);
    expect(verified.findings[0]?.message).toContain('CONTRADICTED');
    const record = shard.provenance?.claimEvidence[0];
    expect(record).toMatchObject({ correctness: 'contradicted', disposition: null });
    const deciding = record?.evidence.find((entry) => entry.evidenceId === record.decidingEvidenceId);
    expect(deciding?.ref).toMatchObject({
      kind: 'value-predicate',
      assertedValue: '"docstube.yaml"',
      extractedValue: '"docstube.yml"'
    });
  });

  it('a value path the snapshot does not know keeps the whole-file fallback and stays UNCHECKED — the kernel never guesses', async () => {
    const spine = await runSpine(
      '`configFileNames.missing` is docstube.yml.',
      hashlessValueLedger('configFileNames.missing is docstube.yml')
    );
    expect(spine.anchored.warnings.some((warning) => warning.includes('kernel resolved the cited value'))).toBe(false);
    expect(spine.shard.ledger?.claims[0]?.subscriptions).toEqual([
      { kind: 'file-content', file: 'src/config.ts', contentHash: READ_HASH }
    ]);
    expectUnchecked(spine);
  });

  it("the writer's own valid cited-value proposal is still honored — the kernel adds nothing", async () => {
    const { anchored, shard } = await runSpine(
      '`MODE` defaults to linear.',
      valueLedger('MODE defaults to linear', 'linear')
    );
    expect(anchored.warnings.some((warning) => warning.includes('kernel resolved the cited value'))).toBe(false);
    expect(shard.ledger?.claims[0]?.subscriptions).toEqual([
      { kind: 'cited-value', symbolHash: MODE_SYMBOL, valueName: 'MODE', citedValue: '"linear"' }
    ]);
    expect(shard.provenance?.claimEvidence[0]).toMatchObject({ correctness: 'checked' });
  });

  // AN UNBINDABLE SUBJECT DEGRADES TO UNCHECKED (impl-15 finding 1) — end to end.
  it('the live cli-reference shape: prose naming the PUBLIC name over an implementation symbol PASSES, unchecked', async () => {
    const mdx = `---
title: "Greet"
---

# Greet

Run it: <Claim id="g1">\`docstube welcome\` prints the greeting.</Claim>
`;
    const spine = await runSpineWithMdx(
      mdx,
      writerClaimLedgerSchema.parse({
        schemaVersion: 1,
        claims: [
          {
            markerId: 'g1',
            class: 'behavior',
            predicate: 'docstube welcome prints the greeting',
            proposedEvidence: [{ kind: 'symbol', symbol: GREET_SYMBOL }],
            proposedSubscriptions: [{ kind: 'body', symbolHash: GREET_SYMBOL }]
          }
        ]
      })
    );
    // Anchoring PASSED (runSpineWithMdx throws otherwise) — no error, no retry, no flagged page.
    expect(spine.anchored.warnings.some((warning) => warning.includes('SUBJECT-UNBOUND'))).toBe(true);
    expect(spine.anchored.rejectedProposals.some((rejected) => rejected.code === 'subject-unbound')).toBe(true);
    // The kernel refused to VOUCH: no source-linked evidence exists for the dropped subject.
    expect(spine.anchored.evidence).toEqual([]);
    expect(spine.verified.findings).toEqual([]);
    expectUnchecked(spine);
    expect(spine.shard.provenance?.claimEvidence[0]?.evidence).toEqual([]);
  });

  it("'`greet` is exported.' mints CHECKED end to end — the record affirms exportedness ('public')", async () => {
    const { verified, shard } = await runSpine('`greet` is exported.', existenceLedger('greet is exported'));
    expect(verified.findings).toEqual([]);
    const record = shard.provenance?.claimEvidence[0];
    expect(record).toMatchObject({ correctness: 'checked', disposition: null });
    const deciding = record?.evidence.find((entry) => entry.evidenceId === record.decidingEvidenceId);
    expect(deciding?.ref).toMatchObject({ kind: 'codemap-grounding', symbol: GREET_SYMBOL });
    expect(deciding?.detail).toContain('exportedness affirmed');
  });

  it("Sol's private-symbol probe: '`hidden` is exported.' persists CONTRADICTED end to end — never checked", async () => {
    const { verified, shard } = await runSpine(
      '`hidden` is exported.',
      existenceLedger('hidden is exported', HIDDEN_SYMBOL)
    );
    expect(verified.findings).toHaveLength(1);
    expect(verified.findings[0]?.message).toContain('CONTRADICTED');
    expect(verified.findings[0]?.message).toContain("'private'");
    const record = shard.provenance?.claimEvidence[0];
    expect(record).toMatchObject({ correctness: 'contradicted', disposition: null });
    const deciding = record?.evidence.find((entry) => entry.evidenceId === record.decidingEvidenceId);
    expect(deciding?.ref).toMatchObject({ kind: 'codemap-grounding', symbol: HIDDEN_SYMBOL });
    expect(deciding?.outcome).toBe('fail');
    expect(shard.ledger?.claims[0]).toMatchObject({ correctness: 'contradicted', disposition: null });
  });

  it("the canonical LIE '`MODE` defaults to cubic.' still mints CONTRADICTED end to end — a caught lie, gating", async () => {
    const { verified, shard } = await runSpine(
      '`MODE` defaults to cubic.',
      valueLedger('MODE defaults to cubic', 'cubic')
    );
    expect(verified.findings).toHaveLength(1);
    expect(verified.findings[0]?.message).toContain('CONTRADICTED');
    const record = shard.provenance?.claimEvidence[0];
    expect(record).toMatchObject({ correctness: 'contradicted', disposition: null });
    const deciding = record?.evidence.find((entry) => entry.evidenceId === record.decidingEvidenceId);
    expect(deciding?.ref).toMatchObject({
      kind: 'value-predicate',
      assertedValue: '"cubic"',
      extractedValue: '"linear"'
    });
  });
});
