import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { codemapSchema, fingerprintSnapshotSchema, sha256Hex, writerClaimLedgerSchema } from '@docstube/contracts';
import type { Codemap, FingerprintSnapshot, ObservedRead } from '@docstube/contracts';
import { hashSymbol } from '@docstube/codemap';
import { extractFingerprints, extractSymbols, typescriptLanguagePack } from '@docstube/lang-typescript';
import { extractPageEntity } from '../entities/extract-entities.ts';
import { anchorWriterLedger } from './anchor-ledger.ts';
import { verifyClaims } from './verify-claims.ts';

// KERNEL SUBJECT RESOLUTION + THE SCHEMA-SHAPE VERIFIER (impl-16 gaps 1 and 3), end to end over a
// real source file, a real fingerprint snapshot, and the real TypeScript pack. The writer ledger
// deliberately proposes NO symbol hash — only the whole-file subscription a writer that has never
// seen the symbol list would propose — because that is exactly the state these claims shipped in.

const COMMIT = 'c'.repeat(40);

const SOURCE = `import { z } from 'zod';

export const agentsConfigSchema = z.strictObject({
  transport: z.enum(['claude-cli', 'codex-cli']).default('claude-cli'),
  apiKeyEnv: z.string().optional(),
  budgets: z.strictObject({ maxRunUsd: z.number().default(20) }).prefault({})
});

export const docstubeConfigSchema = z.strictObject({
  docType: z.string(),
  outDir: z.string().default('docs-site')
});

export const loadConfigFamily = () => undefined;
`;

const mdx = `---
title: "Config"
---

# Config

<Claim id="c1">\`loadConfigFamily\` exists.</Claim>

<Claim id="c2">\`docstubeConfigSchema\` requires \`docType\`.</Claim>

<Claim id="c3">\`agentsConfigSchema\` defines \`apiKeyEnv\`.</Claim>

<Claim id="c4">\`docstubeConfigSchema\` requires \`outDir\`.</Claim>

<Claim id="c5">\`agentsConfigSchema\` defaults \`maxRunUsd\` to 20.</Claim>

<Claim id="c6">\`docstubeConfigSchema.outDir\` defaults to docs-site.</Claim>

<Claim id="c7">\`agentsConfigSchema\` defaults \`transport\` to codex-cli.</Claim>

<Claim id="c8">\`docstubeConfigSchema\` requires \`missingField\`.</Claim>
`;

const FILE = 'src/config.ts';

let repoRoot: string;
let codemap: Codemap;
let fingerprints: FingerprintSnapshot;

beforeAll(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'docstube-schema-shape-'));
  await mkdir(join(repoRoot, 'src'), { recursive: true });
  await writeFile(join(repoRoot, FILE), SOURCE);
  const ctx = {
    repoRoot,
    files: [FILE],
    readFile: async () => SOURCE,
    hashSymbol,
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
  };
  const symbols = await extractSymbols(ctx as never);
  const packFingerprints = await extractFingerprints(ctx as never);
  codemap = codemapSchema.parse({ schemaVersion: 1, commit: COMMIT, symbols });
  fingerprints = fingerprintSnapshotSchema.parse({
    schemaVersion: 1,
    commit: COMMIT,
    symbols: packFingerprints.symbols,
    unparsedFiles: []
  });
});

afterAll(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

const observedReads: ObservedRead[] = [{ file: FILE, contentHash: sha256Hex(SOURCE) }];

const CLASS_OF: Record<string, string> = {
  c1: 'code-structure',
  c2: 'code-structure',
  c3: 'code-structure',
  c4: 'code-structure',
  c5: 'value',
  c6: 'value',
  c7: 'value',
  c8: 'code-structure'
};

const PREDICATES: Record<string, string> = {
  c1: 'loadConfigFamily exists',
  c2: 'docstubeConfigSchema requires docType',
  c3: 'agentsConfigSchema defines apiKeyEnv',
  c4: 'docstubeConfigSchema requires outDir',
  c5: 'agentsConfigSchema defaults maxRunUsd to 20',
  c6: 'docstubeConfigSchema.outDir defaults to docs-site',
  c7: 'agentsConfigSchema defaults transport to codex-cli',
  c8: 'docstubeConfigSchema requires missingField'
};

const run = async () => {
  const page = extractPageEntity({ mdx, slug: 'config' });
  const anchored = anchorWriterLedger({
    mdx,
    writerLedger: writerClaimLedgerSchema.parse({
      schemaVersion: 1,
      claims: Object.entries(PREDICATES).map(([markerId, predicate]) => ({
        markerId,
        class: CLASS_OF[markerId],
        predicate,
        // The writer knows the FILE the fact came from and nothing else — no symbol hash.
        proposedSubscriptions: [{ kind: 'file-content', file: FILE }]
      }))
    }),
    page,
    fingerprints,
    codemap,
    observedReads,
    commit: COMMIT
  });
  if (!anchored.ok) {
    throw new Error(anchored.errors.map((issue) => issue.message).join('; '));
  }
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
  return { anchored, verified };
};

const stateOf = (verified: Awaited<ReturnType<typeof run>>['verified'], markerId: string) => {
  const claim = verified.ledger.claims.find((entry) => entry.anchor.markerId === markerId);
  const evidence = verified.claimEvidence.find((entry) => entry.claimId === claim?.claimId);
  return { correctness: claim?.correctness, kinds: evidence?.evidence.map((record) => record.ref.kind) };
};

describe('kernel subject resolution (gap 1)', () => {
  it('subscribes a canonical existence claim to the symbol it names, and grounds it', async () => {
    const { anchored, verified } = await run();
    const claim = anchored.ledger.claims.find((entry) => entry.anchor.markerId === 'c1');
    expect(claim?.subscriptions.some((subscription) => subscription.kind === 'signature')).toBe(true);
    expect(stateOf(verified, 'c1')).toEqual({ correctness: 'checked', kinds: ['codemap-grounding'] });
  });

  it('leaves the whole-file dependency in place — the subscription is ADDED, never swapped', async () => {
    const { anchored } = await run();
    const claim = anchored.ledger.claims.find((entry) => entry.anchor.markerId === 'c1');
    expect(claim?.subscriptions.some((subscription) => subscription.kind === 'file-content')).toBe(true);
  });
});

describe('the schema-shape verifier (gap 3)', () => {
  it('checks a required field, a defined field, and both default spellings', async () => {
    const { verified } = await run();
    expect(stateOf(verified, 'c2')).toEqual({ correctness: 'checked', kinds: ['schema-check'] });
    expect(stateOf(verified, 'c3')).toEqual({ correctness: 'checked', kinds: ['schema-check'] });
    expect(stateOf(verified, 'c5')).toEqual({ correctness: 'checked', kinds: ['schema-check'] });
    expect(stateOf(verified, 'c6')).toEqual({ correctness: 'checked', kinds: ['schema-check'] });
  });

  it('subscribes schema claims to the BODY facet — the field set lives in the initializer', async () => {
    const { anchored } = await run();
    const claim = anchored.ledger.claims.find((entry) => entry.anchor.markerId === 'c2');
    expect(claim?.subscriptions.some((subscription) => subscription.kind === 'body')).toBe(true);
  });

  it('CONTRADICTS a field documented as required that a caller may omit', async () => {
    const { verified } = await run();
    expect(stateOf(verified, 'c4').correctness).toBe('contradicted');
    expect(
      verified.findings.some((finding) => finding.message.includes('"c4"') && finding.message.includes('CONTRADICTED'))
    ).toBe(true);
  });

  it('CONTRADICTS a documented default the declaration disagrees with', async () => {
    const { verified } = await run();
    expect(stateOf(verified, 'c7').correctness).toBe('contradicted');
    expect(
      verified.findings.some((finding) => finding.message.includes('"c7"') && finding.message.includes('claude-cli'))
    ).toBe(true);
  });

  it('leaves an unresolvable field UNCHECKED — absence is never a contradiction', async () => {
    const { verified } = await run();
    expect(stateOf(verified, 'c8')).toEqual({ correctness: 'unchecked', kinds: [] });
    expect(verified.warnings.some((warning) => warning.includes('"c8"') && warning.includes('missingField'))).toBe(
      true
    );
    expect(verified.findings.some((finding) => finding.message.includes('"c8"'))).toBe(false);
  });

  it('refuses to decide when the declared shape moved after the run was planned', async () => {
    const page = extractPageEntity({ mdx, slug: 'config' });
    const stale = fingerprintSnapshotSchema.parse({
      schemaVersion: 1,
      commit: COMMIT,
      symbols: fingerprints.symbols.map((symbol) => ({ ...symbol, schemaShapePrint: sha256Hex('moved') })),
      unparsedFiles: []
    });
    const anchored = anchorWriterLedger({
      mdx,
      writerLedger: writerClaimLedgerSchema.parse({
        schemaVersion: 1,
        claims: Object.entries(PREDICATES).map(([markerId, predicate]) => ({
          markerId,
          class: CLASS_OF[markerId],
          predicate,
          proposedSubscriptions: [{ kind: 'file-content', file: FILE }]
        }))
      }),
      page,
      fingerprints: stale,
      codemap,
      observedReads,
      commit: COMMIT
    });
    if (!anchored.ok) {
      throw new Error(anchored.errors.map((issue) => issue.message).join('; '));
    }
    const verified = await verifyClaims({
      ledger: anchored.ledger,
      anchored: anchored.anchored,
      anchorEvidence: anchored.evidence,
      rejectedProposals: anchored.rejectedProposals,
      codemap,
      packs: [typescriptLanguagePack],
      repoRoot,
      fingerprints: stale,
      commit: COMMIT
    });
    expect(stateOf(verified, 'c2').correctness).toBe('unchecked');
    expect(verified.warnings.some((warning) => warning.includes('moved mid-run'))).toBe(true);
    // Even a WRONG claim stays unchecked: no evidence is minted from bytes the snapshot never saw.
    expect(stateOf(verified, 'c7').correctness).toBe('unchecked');
  });

  it('leaves a symbol that is not a readable schema unchecked, never grounded by presence', async () => {
    const page = extractPageEntity({ mdx: soloMdx, slug: 'solo' });
    const anchored = anchorWriterLedger({
      mdx: soloMdx,
      writerLedger: writerClaimLedgerSchema.parse({
        schemaVersion: 1,
        claims: [
          {
            markerId: 's1',
            class: 'code-structure',
            predicate: 'loadConfigFamily defines docType',
            proposedSubscriptions: [{ kind: 'file-content', file: FILE }]
          }
        ]
      }),
      page,
      fingerprints,
      codemap,
      observedReads,
      commit: COMMIT
    });
    if (!anchored.ok) {
      throw new Error(anchored.errors.map((issue) => issue.message).join('; '));
    }
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
    expect(stateOf(verified, 's1')).toEqual({ correctness: 'unchecked', kinds: [] });
  });
});

const soloMdx = `---
title: "Solo"
---

# Solo

<Claim id="s1">\`loadConfigFamily\` defines \`docType\`.</Claim>
`;
