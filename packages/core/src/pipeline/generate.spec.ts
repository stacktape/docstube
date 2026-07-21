import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanClaimMarkers } from '@docstube/agent-runtime';
import { buildCodemap } from '@docstube/codemap';
import { typescriptLanguagePack } from '@docstube/lang-typescript';
import { writerClaimLedgerSchema } from '@docstube/contracts';
import type { AgentTaskSpec, Transcript, WriterClaimLedger } from '@docstube/contracts';
import { createManifestStore } from '../state/manifest-store.ts';
import { createRunJournal } from '../state/run-journal.ts';
import { runGenerate, unwrapMdxFence } from './generate.ts';

// End-to-end pipeline test over a real temp repo with the real builtin plugins (verifiers +
// lang-typescript). The writer and reviewers are a scripted TaskRunner — CI never calls a live
// model. Writer tasks return the wave 2b-i artifact shape: MDX with inline <Claim> markers plus
// the writer claim ledger, exactly what an accepted submit_page call produces.

// Derives a marker-consistent writer ledger from the scripted MDX, the way a cooperating writer
// would author one (one code-structure claim per marker). Code-dependent claims must carry a
// resolvable dependency (fail-closed anchoring), so the scripted writer proposes the source file
// it "read" — the kernel resolves the authoritative hash from the observed reads.
const ledgerFor = (mdx: string): WriterClaimLedger => ({
  schemaVersion: 1,
  claims: scanClaimMarkers(mdx).markers.map((marker) => ({
    markerId: marker.markerId,
    class: 'code-structure',
    predicate: marker.innerMdx,
    proposedEvidence: [],
    proposedSubscriptions: [{ kind: 'file-content', file: 'src/greeter.ts' }]
  }))
});

const writeResult = (mdx: string): Transcript['result'] => ({ type: 'mdx-ledger', mdx, ledger: ledgerFor(mdx) });

let repoRoot: string;

const fixtureSource = `export type GreetOptions = {
  name: string;
  loud?: boolean;
};

export const DEFAULT_RETRIES = 3;

export const greet = (options: GreetOptions): string => {
  const base = \`Hello, \${options.name}!\`;
  return options.loud ? base.toUpperCase() : base;
};
`;

const configYaml = `schemaVersion: 1
docType: external-library
projectContext: A tiny greeting library.
personas:
  - id: app-developer
    description: Builds apps using the library
site:
  title: Greeter Docs
`;

const iaYaml = `schemaVersion: 1
tree:
  - title: Getting started
    slug: getting-started
    brief: Install the library and greet someone.
`;

const goodMdx = `---
title: Getting started
description: Install and greet.
---

# Getting started

<Claim id="c1">The library exposes a single \`greet\` function.</Claim>

## Usage

\`\`\`ts
import { greet } from 'greeter';

const message: string = greet({ name: 'Ada' });
\`\`\`
`;

// Planted defect: a self-contained type error (module-resolution diagnostics are deliberately
// skipped by the verifier, so the defect must not depend on the unresolved import).
const badMdx = goodMdx.replace(
  "const message: string = greet({ name: 'Ada' });",
  "const message: number = 'not a number';"
);

const baseTranscript = (spec: AgentTaskSpec): Omit<Transcript, 'result' | 'turns'> => ({
  schemaVersion: 1,
  taskId: spec.id,
  cacheKey: 'test',
  transport: 'replay',
  model: 'scripted',
  observedReads: [{ file: 'src/greeter.ts', contentHash: '0'.repeat(64) }],
  usage: { inputTokens: 1, outputTokens: 1, cacheHit: false },
  stopReason: 'complete'
});

const passingReview = (spec: AgentTaskSpec): Transcript => ({
  ...baseTranscript(spec),
  observedReads: [],
  turns: [],
  result: {
    type: 'structured',
    value: {
      persona: 'app-developer',
      criteria: [{ criterion: 'audience-fit', outcome: 'met', reasoning: 'Clear for app developers.' }],
      findings: []
    }
  }
});

// Dispatches by task kind: write-page consumes the scripted MDX queue; review-page passes.
const scriptedRunner = (writeResponses: string[]) => {
  const remaining = [...writeResponses];
  const writeCalls: AgentTaskSpec[] = [];
  const reviewCalls: AgentTaskSpec[] = [];
  const runTask = async (spec: AgentTaskSpec): Promise<Transcript> => {
    if (spec.kind === 'review-page') {
      reviewCalls.push(spec);
      return passingReview(spec);
    }
    writeCalls.push(spec);
    const mdx = remaining.shift();
    if (mdx === undefined) {
      throw new Error('scripted runner exhausted');
    }
    return {
      ...baseTranscript(spec),
      turns: [{ role: 'assistant', blocks: [{ type: 'text', text: mdx }] }],
      result: writeResult(mdx)
    };
  };
  return { runTask, writeCalls, reviewCalls };
};

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'docstube-e2e-'));
  await mkdir(join(repoRoot, 'src'), { recursive: true });
  await writeFile(join(repoRoot, 'src', 'greeter.ts'), fixtureSource);
  await writeFile(join(repoRoot, 'package.json'), JSON.stringify({ name: 'greeter', type: 'module' }));
  await writeFile(join(repoRoot, 'docstube.yml'), configYaml);
  await writeFile(join(repoRoot, 'ia.yml'), iaYaml);
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

describe('runGenerate', () => {
  it('generates a verified page: manifest shard, mdx output, proven code block, persona review ran', async () => {
    const { runTask, writeCalls, reviewCalls } = scriptedRunner([goodMdx]);
    const summary = await runGenerate({ repoRoot, runTask, toolDescriptors: [] });

    expect(summary.outcome).toBe('passed');
    expect(summary.pages).toHaveLength(1);
    expect(summary.pages[0]?.status).toBe('passed');
    expect(writeCalls).toHaveLength(1);
    // One reviewer per persona per attempt.
    expect(reviewCalls).toHaveLength(1);
    expect(reviewCalls[0]?.output.type).toBe('structured');
    expect(reviewCalls[0]?.systemPrompt).toContain('app-developer');

    const mdxOnDisk = await readFile(join(repoRoot, 'docs-site', 'content', 'en', 'getting-started.mdx'), 'utf8');
    expect(mdxOnDisk).toContain('# Getting started');

    const store = createManifestStore(repoRoot, 'latest');
    const index = await store.readIndex();
    expect(index?.pages).toHaveLength(1);
    const shard = await store.readPageShard({ locale: 'en', pageId: index?.pages[0]?.id ?? '' });
    expect(shard?.page.provenance.observedReads[0]?.file).toBe('src/greeter.ts');
    // Symbols in observed-read files become page-level sources (grounds coverage + refresh scoping).
    expect(shard?.page.provenance.sources.length).toBeGreaterThan(0);
    expect(shard?.page.provenance.sources.every((source) => source.file === 'src/greeter.ts')).toBe(true);
    // The committed manifest explains the 'scored' badge too: compact review verdicts travel in
    // provenance (persona + per-criterion outcome + run id), not just deterministic verifications.
    expect(shard?.page.provenance.reviews.length).toBeGreaterThan(0);
    expect(shard?.page.provenance.reviews[0]).toMatchObject({ persona: expect.any(String), runId: expect.any(String) });
    // The trust spine is the shard's kernel ledger + ClaimEvidence — the legacy per-block
    // ClaimEntity/guarantee ladder is gone from the live pipeline (wave 2b-iii demolition).
    expect(shard?.ledger?.claims).toHaveLength(1);
    expect(shard?.ledger?.claims[0]).toMatchObject({
      class: 'code-structure',
      correctness: 'unchecked',
      disposition: 'no-checker-available'
    });
    expect(shard?.ledger?.claims[0]?.claimId).toMatch(/^cl_/);
    expect(shard?.provenance?.claimEvidence).toHaveLength(1);
    expect(shard?.provenance?.claimEvidence[0]?.claimId).toBe(shard?.ledger?.claims[0]?.claimId);
    // Blocks carry no legacy ClaimEntity records anymore.
    const blocks = [...(shard?.page.preamble ?? []), ...(shard?.page.sections.flatMap((s) => s.blocks) ?? [])];
    expect(blocks.every((block) => block.claims.length === 0)).toBe(true);
    // The inline marker survives into the shipped MDX (theme rendering is a later wave).
    expect(mdxOnDisk).toContain('<Claim id="c1">');
  }, 60_000);

  it('retries on verifier findings and passes with the fixed draft', async () => {
    const { runTask, writeCalls } = scriptedRunner([badMdx, goodMdx]);
    const summary = await runGenerate({ repoRoot, runTask, toolDescriptors: [] });

    expect(writeCalls).toHaveLength(2);
    // The retry prompt carries the findings forward AND the failed draft, as an edit instruction.
    expect(writeCalls[1]?.userPrompt).toContain('FAILED verification');
    expect(writeCalls[1]?.userPrompt).toContain('code-typecheck-ts');
    expect(writeCalls[1]?.userPrompt).toContain('--- PREVIOUS DRAFT START ---');
    expect(writeCalls[1]?.userPrompt).toContain("const message: number = 'not a number';");
    expect(summary.outcome).toBe('passed');
  }, 60_000);

  it('clamps a non-positive maxAttemptsPerPage to one attempt instead of crashing', async () => {
    const { runTask, writeCalls } = scriptedRunner([goodMdx]);
    const summary = await runGenerate({ repoRoot, runTask, toolDescriptors: [], maxAttemptsPerPage: 0 });
    expect(writeCalls).toHaveLength(1);
    expect(summary.pages[0]?.attempts).toBe(1);
  }, 60_000);

  it('runs ONLY the primary persona review — secondary personas are not reviewed in this slice', async () => {
    // Two configured personas; the page's primary (the ia.yml v2 default: the first persona)
    // gates. Sampled secondary ADVISORY reviews arrive with the review-routing wave.
    const twoPersonaConfig = configYaml.replace(
      '  - id: app-developer\n    description: Builds apps using the library\n',
      '  - id: app-developer\n    description: Builds apps using the library\n  - id: ops-engineer\n    description: Operates deployments\n'
    );
    await writeFile(join(repoRoot, 'docstube.yml'), twoPersonaConfig);
    const { runTask, reviewCalls } = scriptedRunner([goodMdx]);
    const summary = await runGenerate({ repoRoot, runTask, toolDescriptors: [] });

    expect(summary.outcome).toBe('passed');
    expect(reviewCalls).toHaveLength(1);
    expect(reviewCalls[0]?.systemPrompt).toContain('app-developer');
    expect(reviewCalls[0]?.systemPrompt).not.toContain('ops-engineer');

    // The persisted assessment records the correct role and the IA fragment dependency.
    const store = createManifestStore(repoRoot, 'latest');
    const index = await store.readIndex();
    const shard = await store.readPageShard({ locale: 'en', pageId: index?.pages[0]?.id ?? '' });
    expect(shard?.provenance?.assessments.reviews).toHaveLength(1);
    expect(shard?.provenance?.assessments.reviews[0]).toMatchObject({
      persona: 'app-developer',
      role: 'primary-gating',
      completion: 'completed'
    });
    const iaFragment = shard?.provenance?.dependencies.consumed.find((fragment) => fragment.kind === 'ia');
    expect(iaFragment?.id).toBe('ia:getting-started');
  }, 60_000);

  it('threads the standard read-only tools into review tasks — reviewers get source access', async () => {
    const descriptor = {
      name: 'read_file',
      description: 'Read a repo file.',
      paramsJsonSchema: { type: 'object', properties: { path: { type: 'string' } } }
    };
    const { runTask, reviewCalls } = scriptedRunner([goodMdx]);
    await runGenerate({ repoRoot, runTask, toolDescriptors: [descriptor] });
    expect(reviewCalls[0]?.tools.map((tool) => tool.name)).toContain('read_file');
  }, 60_000);

  it('journals a run-completed failed event when the pipeline escapes with an error', async () => {
    const runId = 'run_00000000000000000009';
    await expect(
      runGenerate({
        repoRoot,
        runTask: () => Promise.reject(new Error('transport exploded')),
        toolDescriptors: [],
        runId
      })
    ).rejects.toThrow('transport exploded');
    const journal = await createRunJournal(repoRoot, runId);
    const events = await journal.readAll();
    const terminal = events.at(-1);
    expect(terminal).toMatchObject({ type: 'run-completed', outcome: 'failed', error: 'transport exploded' });
  }, 60_000);

  it('journals a warning when a persona review is skipped (invalid reviewer output)', async () => {
    const runId = 'run_00000000000000000010';
    const runTask = async (spec: AgentTaskSpec): Promise<Transcript> => {
      if (spec.kind === 'review-page') {
        return {
          ...baseTranscript(spec),
          observedReads: [],
          turns: [],
          result: { type: 'structured', value: { nonsense: true } }
        };
      }
      return {
        ...baseTranscript(spec),
        turns: [{ role: 'assistant', blocks: [{ type: 'text', text: goodMdx }] }],
        result: writeResult(goodMdx)
      };
    };
    const summary = await runGenerate({ repoRoot, runTask, toolDescriptors: [], runId });
    // A skipped review never gates the page, but it must be visible in the journal.
    expect(summary.pages[0]?.status).toBe('passed');
    const journal = await createRunJournal(repoRoot, runId);
    const events = await journal.readAll();
    const warning = events
      .flatMap((event) => (event.type === 'findings' ? event.findings : []))
      .find((finding) => finding.check === 'review-error');
    expect(warning?.severity).toBe('warning');
    expect(warning?.message).toContain('app-developer');
  }, 60_000);

  it('retries when a persona reviewer finds an error-severity problem', async () => {
    const remaining = [goodMdx, goodMdx];
    let reviewCount = 0;
    const runTask = async (spec: AgentTaskSpec): Promise<Transcript> => {
      if (spec.kind === 'review-page') {
        reviewCount += 1;
        if (reviewCount === 1) {
          return {
            ...baseTranscript(spec),
            observedReads: [],
            turns: [],
            result: {
              type: 'structured',
              value: {
                persona: 'app-developer',
                criteria: [{ criterion: 'audience-fit', outcome: 'not-met', reasoning: 'Assumes internal knowledge.' }],
                findings: [
                  {
                    source: 'review',
                    check: 'audience-fit',
                    severity: 'error',
                    message: 'The page assumes repository-internal context an app developer cannot have.'
                  }
                ]
              }
            }
          };
        }
        return passingReview(spec);
      }
      const mdx = remaining.shift();
      if (mdx === undefined) {
        throw new Error('exhausted');
      }
      return {
        ...baseTranscript(spec),
        turns: [{ role: 'assistant', blocks: [{ type: 'text', text: mdx }] }],
        result: writeResult(mdx)
      };
    };
    const summary = await runGenerate({ repoRoot, runTask, toolDescriptors: [] });
    expect(reviewCount).toBe(2);
    expect(summary.outcome).toBe('passed');
    expect(summary.pages[0]?.attempts).toBe(2);
  }, 60_000);

  it('ships verified translations with the same entity ids as the source', async () => {
    await writeFile(join(repoRoot, 'docstube.yml'), `${configYaml}locales:\n  source: en\n  targets: [de]\n`);
    const germanMdx = goodMdx
      .replace('title: Getting started', 'title: Erste Schritte')
      .replace('description: Install and greet.', 'description: Installieren und begrüßen.')
      .replace('# Getting started', '# Erste Schritte')
      .replace(
        'The library exposes a single `greet` function.',
        'Die Bibliothek stellt eine einzige `greet`-Funktion bereit.'
      )
      .replace('## Usage', '## Verwendung');
    const runTask = async (spec: AgentTaskSpec): Promise<Transcript> => {
      if (spec.kind === 'review-page') {
        return passingReview(spec);
      }
      const mdx = spec.kind === 'translate-page' ? germanMdx : goodMdx;
      return {
        ...baseTranscript(spec),
        turns: [{ role: 'assistant', blocks: [{ type: 'text', text: mdx }] }],
        result: spec.kind === 'translate-page' ? { type: 'mdx', mdx } : writeResult(mdx)
      };
    };
    const summary = await runGenerate({ repoRoot, runTask, toolDescriptors: [] });

    expect(summary.outcome).toBe('passed');
    expect(summary.translations).toEqual([{ locale: 'de', slug: 'getting-started', status: 'passed', findings: [] }]);
    const store = createManifestStore(repoRoot, 'latest');
    const index = await store.readIndex();
    const pageId = index?.pages[0]?.id ?? '';
    const enShard = await store.readPageShard({ locale: 'en', pageId });
    const deShard = await store.readPageShard({ locale: 'de', pageId });
    expect(deShard?.page.id).toBe(enShard?.page.id);
    expect(deShard?.page.title).toBe('Erste Schritte');
    // Locale is an address dimension: identical entity ids across locales.
    expect(deShard?.page.sections.map((section) => section.id)).toEqual(
      enShard?.page.sections.map((section) => section.id)
    );
    // The code block is byte-identical across locales (alignment invariant); trust lives on the
    // SOURCE shard's ledger — rendition shards carry no ledger of their own.
    const deCode = deShard?.page.sections
      .flatMap((section) => section.blocks)
      .find((block) => block.blockType === 'code-example');
    const enCode = enShard?.page.sections
      .flatMap((section) => section.blocks)
      .find((block) => block.blockType === 'code-example');
    expect(deCode?.contentHash).toBe(enCode?.contentHash);
    expect(deShard?.ledger).toBeUndefined();
    expect(enShard?.ledger?.claims).toHaveLength(1);
    const deMdx = await readFile(join(repoRoot, 'docs-site', 'content', 'de', 'getting-started.mdx'), 'utf8');
    expect(deMdx).toContain('# Erste Schritte');
  }, 60_000);

  it('flags a translation that breaks document structure instead of shipping it silently', async () => {
    await writeFile(join(repoRoot, 'docstube.yml'), `${configYaml}locales:\n  source: en\n  targets: [de]\n`);
    // The "translation" drops the Usage section entirely — ids cannot align.
    const brokenTranslation = goodMdx.split('## Usage')[0] ?? '';
    const runTask = async (spec: AgentTaskSpec): Promise<Transcript> => {
      if (spec.kind === 'review-page') {
        return passingReview(spec);
      }
      const mdx = spec.kind === 'translate-page' ? brokenTranslation : goodMdx;
      return {
        ...baseTranscript(spec),
        turns: [{ role: 'assistant', blocks: [{ type: 'text', text: mdx }] }],
        result: spec.kind === 'translate-page' ? { type: 'mdx', mdx } : writeResult(mdx)
      };
    };
    const summary = await runGenerate({ repoRoot, runTask, toolDescriptors: [] });
    expect(summary.outcome).toBe('flagged');
    expect(summary.translations[0]?.status).toBe('flagged');
    expect(summary.translations[0]?.findings[0]?.check).toBe('translation-structure');
    // A failed translation never emits MDX under the locale path: the fallback artifact is the
    // untranslated source page, and shipping it as "de" would be silently wrong.
    await expect(readFile(join(repoRoot, 'docs-site', 'content', 'de', 'getting-started.mdx'), 'utf8')).rejects.toThrow(
      /ENOENT/
    );
    // The shard (with its open flag) still persists so status and the flag queue see the failure.
    const store = createManifestStore(repoRoot, 'latest');
    const index = await store.readIndex();
    const deShard = await store.readPageShard({ locale: 'de', pageId: index?.pages[0]?.id ?? '' });
    expect(deShard?.flags.some((flag) => flag.status === 'open')).toBe(true);
  }, 60_000);

  it('rejects a translation that alters a code block — byte-identical or flagged, never downgraded', async () => {
    await writeFile(join(repoRoot, 'docstube.yml'), `${configYaml}locales:\n  source: en\n  targets: [de]\n`);
    // Structure is intact; only the code block's content changed — an altered command must be an
    // alignment error, not a silent guarantee downgrade.
    const alteredCodeTranslation = goodMdx
      .replace('# Getting started', '# Erste Schritte')
      .replace("greet({ name: 'Ada' })", "greet({ name: 'Bob' })");
    const runTask = async (spec: AgentTaskSpec): Promise<Transcript> => {
      if (spec.kind === 'review-page') {
        return passingReview(spec);
      }
      const mdx = spec.kind === 'translate-page' ? alteredCodeTranslation : goodMdx;
      return {
        ...baseTranscript(spec),
        turns: [{ role: 'assistant', blocks: [{ type: 'text', text: mdx }] }],
        result: spec.kind === 'translate-page' ? { type: 'mdx', mdx } : writeResult(mdx)
      };
    };
    const summary = await runGenerate({ repoRoot, runTask, toolDescriptors: [] });

    expect(summary.outcome).toBe('flagged');
    expect(summary.translations[0]?.status).toBe('flagged');
    expect(summary.translations[0]?.findings[0]?.check).toBe('translation-structure');
    expect(summary.translations[0]?.findings[0]?.message).toContain('byte-identical');
    await expect(readFile(join(repoRoot, 'docs-site', 'content', 'de', 'getting-started.mdx'), 'utf8')).rejects.toThrow(
      /ENOENT/
    );
  }, 60_000);

  it('site-scope findings land as open system flags on the named page shard, deduped across runs', async () => {
    // A dead internal link passes per-page verification (internal-links is site-scope only) but
    // fails the topology pass — the shard must carry the flag or `docstube status` lies.
    const deadLinkMdx = `${goodMdx}\nSee [the missing page](/does-not-exist) for more.\n`;
    const first = await runGenerate({ repoRoot, toolDescriptors: [], runTask: scriptedRunner([deadLinkMdx]).runTask });

    expect(first.outcome).toBe('flagged');
    expect(first.siteFindings.some((finding) => finding.check === 'internal-links')).toBe(true);
    expect(first.openFlagKinds).toContain('system');

    const store = createManifestStore(repoRoot, 'latest');
    const index = await store.readIndex();
    const pageId = index?.pages[0]?.id ?? '';
    const shard = await store.readPageShard({ locale: 'en', pageId });
    const siteFlags = shard?.flags.filter((flag) => flag.kind === 'system' && flag.status === 'open') ?? [];
    expect(siteFlags).toHaveLength(1);
    expect(siteFlags[0]?.summary).toContain('internal-links');
    expect(siteFlags[0]?.entity?.pageId).toBe(pageId);

    // Second run with the same defect: the identical open flag is not stacked. The page id is
    // stable across runs (entity matching), so the shard-level dedup can hold.
    await runGenerate({ repoRoot, toolDescriptors: [], runTask: scriptedRunner([deadLinkMdx]).runTask });
    const shardAfter = await store.readPageShard({ locale: 'en', pageId });
    expect(shardAfter?.flags.filter((flag) => flag.kind === 'system' && flag.status === 'open')).toHaveLength(1);
  }, 60_000);

  it('regeneration of unchanged MDX keeps ONE claim identity and records an exact match', async () => {
    // A dependency-triggered regeneration of unchanged MDX must not mint a second claim identity:
    // the fresh ledger claim threads onto the prior ledger's id (identity carries) while its
    // correctness/disposition are recomputed from THIS run (trust never carries) — and the shard
    // persists the typed claimMatching record proving the thread was exact.
    const first = await runGenerate({ repoRoot, toolDescriptors: [], runTask: scriptedRunner([goodMdx]).runTask });
    expect(first.outcome).toBe('passed');

    const store = createManifestStore(repoRoot, 'latest');
    const index = await store.readIndex();
    const pageId = index?.pages[0]?.id ?? '';
    const shard = await store.readPageShard({ locale: 'en', pageId });
    const previousClaimId = shard?.ledger?.claims[0]?.claimId;
    expect(previousClaimId).toMatch(/^cl_/);

    // Second run: unchanged MDX regenerates (generate always rewrites).
    const second = await runGenerate({ repoRoot, toolDescriptors: [], runTask: scriptedRunner([goodMdx]).runTask });
    expect(second.outcome).toBe('passed');
    const regenerated = await store.readPageShard({ locale: 'en', pageId });
    // ONE claim identity across runs, in the freshly recomputed state.
    expect(regenerated?.ledger?.claims).toHaveLength(1);
    expect(regenerated?.ledger?.claims[0]?.claimId).toBe(previousClaimId);
    expect(regenerated?.ledger?.claims[0]).toMatchObject({
      correctness: 'unchecked',
      disposition: 'no-checker-available'
    });
    // The persisted typed matching record: an exact thread, no drift, no orphans.
    expect(regenerated?.claimMatching?.matches).toEqual([{ claimId: previousClaimId, confidence: 'exact', drift: [] }]);
    expect(regenerated?.claimMatching?.orphans).toEqual([]);
  }, 120_000);

  it('fails closed when a claim cannot anchor: writer repair, then flagged — never a shrunken ledger', async () => {
    // A marker in a heading plus its ledger entry: submit_page rejects this in-session on real
    // transports; the scripted runner bypasses submit_page, so anchoring must catch it as a
    // repair-eligible error that feeds the retry loop and finally flags the page.
    const headingClaimMdx = goodMdx.replace('## Usage', '## <Claim id="h1">Usage claims things</Claim>');
    const runTask = async (spec: AgentTaskSpec): Promise<Transcript> => {
      if (spec.kind === 'review-page') {
        return passingReview(spec);
      }
      return {
        ...baseTranscript(spec),
        turns: [{ role: 'assistant', blocks: [{ type: 'text', text: headingClaimMdx }] }],
        result: {
          type: 'mdx-ledger',
          mdx: headingClaimMdx,
          ledger: {
            schemaVersion: 1,
            claims: [
              ...ledgerFor(headingClaimMdx).claims,
              {
                markerId: 'h1',
                class: 'code-structure',
                predicate: 'usage claims things',
                proposedEvidence: [],
                proposedSubscriptions: []
              }
            ]
          }
        }
      };
    };
    const summary = await runGenerate({ repoRoot, runTask, toolDescriptors: [], maxAttemptsPerPage: 2 });

    // Both attempts hit the anchoring error: the page ships FLAGGED with the precise error —
    // never 'passed' with the h1 claim silently dropped from the ledger denominator.
    expect(summary.pages[0]?.status).toBe('flagged');
    expect(summary.pages[0]?.findings.some((finding) => finding.check === 'claim-anchoring')).toBe(true);
    expect(summary.pages[0]?.findings.some((finding) => finding.message.includes('h1'))).toBe(true);
    expect(summary.pages[0]?.attempts).toBe(2);
    const store = createManifestStore(repoRoot, 'latest');
    const index = await store.readIndex();
    const shard = await store.readPageShard({ locale: 'en', pageId: index?.pages[0]?.id ?? '' });
    expect(shard?.flags.some((flag) => flag.status === 'open' && flag.detail?.includes('claim-anchoring'))).toBe(true);
  }, 120_000);

  // The value-predicate e2e pair (wave 2b-ii): the writer asserts a default; the kernel compares
  // it against the language pack's extracted value. Right value → checked. Wrong value: the
  // VISIBLE prose states the same wrong value (bidirectional binding holds — this is a lie, not a
  // laundering attempt) → CONTRADICTED → blocking finding → retries → flagged, never neutral.
  const valueMdxWith = (citedValue: string) => `${goodMdx}
<Claim id="v1">\`DEFAULT_RETRIES\` defaults to ${citedValue}.</Claim>
`;

  const valueRunner = async (citedValue: string) => {
    const valueMdx = valueMdxWith(citedValue);
    // The scripted writer proposes the REAL symbol hash, exactly like a cooperating writer that
    // read the API surface list.
    const codemap = await buildCodemap({
      repoRoot,
      commit: 'a'.repeat(40),
      packs: [typescriptLanguagePack],
      logger: { info: () => {}, warn: () => {} }
    });
    const symbolHash = codemap.symbols.find((symbol) => symbol.name === 'DEFAULT_RETRIES')?.hash;
    if (symbolHash === undefined) {
      throw new Error('fixture symbol DEFAULT_RETRIES not in the codemap');
    }
    const ledger: WriterClaimLedger = writerClaimLedgerSchema.parse({
      schemaVersion: 1,
      claims: [
        ...ledgerFor(valueMdx).claims.filter((claim) => claim.markerId !== 'v1'),
        {
          markerId: 'v1',
          class: 'value',
          predicate: `DEFAULT_RETRIES defaults to ${citedValue}`,
          proposedEvidence: [{ kind: 'symbol', symbol: symbolHash }],
          proposedSubscriptions: [{ kind: 'cited-value', symbolHash, valueName: 'DEFAULT_RETRIES', citedValue }]
        }
      ]
    });
    return async (spec: AgentTaskSpec): Promise<Transcript> => {
      if (spec.kind === 'review-page') {
        return passingReview(spec);
      }
      return {
        ...baseTranscript(spec),
        turns: [{ role: 'assistant', blocks: [{ type: 'text', text: valueMdx }] }],
        result: { type: 'mdx-ledger', mdx: valueMdx, ledger }
      };
    };
  };

  it('value-predicate: a correct asserted default ends CHECKED with deciding evidence on the shard', async () => {
    const summary = await runGenerate({ repoRoot, runTask: await valueRunner('3'), toolDescriptors: [] });
    expect(summary.outcome).toBe('passed');

    const store = createManifestStore(repoRoot, 'latest');
    const index = await store.readIndex();
    const shard = await store.readPageShard({ locale: 'en', pageId: index?.pages[0]?.id ?? '' });
    const valueClaim = shard?.ledger?.claims.find((claim) => claim.class === 'value');
    expect(valueClaim).toMatchObject({ correctness: 'checked', disposition: null });
    const evidence = shard?.provenance?.claimEvidence.find((record) => record.claimId === valueClaim?.claimId);
    const deciding = evidence?.evidence.find((record) => record.evidenceId === evidence.decidingEvidenceId);
    expect(deciding?.outcome).toBe('pass');
    expect(deciding?.ref).toMatchObject({
      kind: 'value-predicate',
      valueName: 'DEFAULT_RETRIES',
      assertedValue: '3',
      extractedValue: '3'
    });
  }, 120_000);

  it('value-predicate: a wrong asserted default is CONTRADICTED — blocking finding, retries, then flagged', async () => {
    const runTask = await valueRunner('5');
    const summary = await runGenerate({ repoRoot, runTask, toolDescriptors: [], maxAttemptsPerPage: 2 });

    // The contradiction gates: the page never passes, retries burn down, the shard ships flagged
    // with the precise asserted-vs-extracted detail — a caught lie is never neutral content.
    expect(summary.outcome).toBe('flagged');
    expect(summary.pages[0]?.status).toBe('flagged');
    expect(summary.pages[0]?.attempts).toBe(2);
    const contradiction = summary.pages[0]?.findings.find((finding) => finding.check === 'claim-verification');
    expect(contradiction?.severity).toBe('error');
    expect(contradiction?.message).toContain('CONTRADICTED');
    expect(contradiction?.message).toContain('asserted as 5');
    expect(contradiction?.message).toContain('extracts 3');

    const store = createManifestStore(repoRoot, 'latest');
    const index = await store.readIndex();
    const shard = await store.readPageShard({ locale: 'en', pageId: index?.pages[0]?.id ?? '' });
    expect(shard?.flags.some((flag) => flag.status === 'open' && flag.detail?.includes('claim-verification'))).toBe(
      true
    );
    // The flagged shard's ledger carries the contradiction explicitly — never a neutral state.
    expect(shard?.ledger?.claims.some((claim) => claim.correctness === 'contradicted')).toBe(true);
  }, 120_000);

  it('first generation with a contradiction persists the contradicted state LOUD in the shard', async () => {
    // No prior page exists: the page ships flagged WITH its final kernel ledger + ClaimEvidence,
    // the contradiction explicit and machine-readable — never a bare flag over clean prose.
    const runTask = await valueRunner('5');
    await runGenerate({ repoRoot, runTask, toolDescriptors: [], maxAttemptsPerPage: 2 });

    const store = createManifestStore(repoRoot, 'latest');
    const index = await store.readIndex();
    const shard = await store.readPageShard({ locale: 'en', pageId: index?.pages[0]?.id ?? '' });
    const contradicted = shard?.ledger?.claims.find((claim) => claim.correctness === 'contradicted');
    expect(contradicted).toBeDefined();
    expect(contradicted?.disposition).toBeNull();
    const evidence = shard?.provenance?.claimEvidence.find((record) => record.claimId === contradicted?.claimId);
    expect(evidence?.correctness).toBe('contradicted');
    const deciding = evidence?.evidence.find((record) => record.evidenceId === evidence.decidingEvidenceId);
    expect(deciding?.outcome).toBe('fail');
    expect(deciding?.ref).toMatchObject({ kind: 'value-predicate', assertedValue: '5', extractedValue: '3' });
    expect(shard?.flags.some((flag) => flag.status === 'open')).toBe(true);
  }, 120_000);

  it('never mixes attempts: a verified attempt 1 + final anchoring-failed attempt 2 persists NO stale trust spine (Sol impl-07 probe)', async () => {
    // Attempt 1 reaches verification and is CONTRADICTED (it has a full ledger/provenance);
    // attempt 2 — the final attempt — fails anchoring (marker in a heading). With no prior
    // published page, the persisted shard must be entirely attempt-2-consistent: attempt 2's MDX
    // with NO ledger, provenance, or matching — never attempt 1's trust state under attempt 2's
    // prose.
    const contradictedMdx = valueMdxWith('5');
    const headingClaimMdx = goodMdx.replace('## Usage', '## <Claim id="h1">Usage claims things</Claim>');
    const codemap = await buildCodemap({
      repoRoot,
      commit: 'a'.repeat(40),
      packs: [typescriptLanguagePack],
      logger: { info: () => {}, warn: () => {} }
    });
    const symbolHash = codemap.symbols.find((symbol) => symbol.name === 'DEFAULT_RETRIES')?.hash ?? '';
    const attempt1Ledger = writerClaimLedgerSchema.parse({
      schemaVersion: 1,
      claims: [
        ...ledgerFor(contradictedMdx).claims.filter((entry) => entry.markerId !== 'v1'),
        {
          markerId: 'v1',
          class: 'value',
          predicate: 'DEFAULT_RETRIES defaults to 5',
          proposedEvidence: [{ kind: 'symbol', symbol: symbolHash }],
          proposedSubscriptions: [{ kind: 'cited-value', symbolHash, valueName: 'DEFAULT_RETRIES', citedValue: '5' }]
        }
      ]
    });
    const attempt2Ledger = writerClaimLedgerSchema.parse({
      schemaVersion: 1,
      claims: [
        ...ledgerFor(headingClaimMdx).claims,
        { markerId: 'h1', class: 'code-structure', predicate: 'usage claims things' }
      ]
    });
    let writeCall = 0;
    const runTask = async (spec: AgentTaskSpec): Promise<Transcript> => {
      if (spec.kind === 'review-page') {
        return passingReview(spec);
      }
      writeCall += 1;
      const mdx = writeCall === 1 ? contradictedMdx : headingClaimMdx;
      const ledger = writeCall === 1 ? attempt1Ledger : attempt2Ledger;
      return {
        ...baseTranscript(spec),
        turns: [{ role: 'assistant', blocks: [{ type: 'text', text: mdx }] }],
        result: { type: 'mdx-ledger', mdx, ledger }
      };
    };
    const summary = await runGenerate({ repoRoot, runTask, toolDescriptors: [], maxAttemptsPerPage: 2 });

    expect(summary.pages[0]?.status).toBe('flagged');
    expect(summary.pages[0]?.attempts).toBe(2);
    // The final findings are attempt 2's anchoring errors, not attempt 1's contradiction.
    expect(summary.pages[0]?.findings.every((finding) => finding.check === 'claim-anchoring')).toBe(true);

    const store = createManifestStore(repoRoot, 'latest');
    const index = await store.readIndex();
    const shard = await store.readPageShard({ locale: 'en', pageId: index?.pages[0]?.id ?? '' });
    expect(shard).toBeDefined();
    // Attempt-consistent shard: attempt 2 never reached a kernel ledger, so NOTHING of attempt
    // 1's trust spine may persist.
    expect(shard?.ledger).toBeUndefined();
    expect(shard?.provenance).toBeUndefined();
    expect(shard?.claimMatching).toBeUndefined();
    // The shipped MDX is attempt 2's prose (flagged, visible — never attempt 1's).
    const mdxOnDisk = await readFile(join(repoRoot, 'docs-site', 'content', 'en', 'getting-started.mdx'), 'utf8');
    expect(mdxOnDisk).toContain('Usage claims things');
    expect(mdxOnDisk).not.toContain('defaults to 5');
    expect(shard?.flags.some((flag) => flag.status === 'open' && flag.detail?.includes('claim-anchoring'))).toBe(true);
  }, 180_000);

  it('RETAINS the previously published page byte-for-byte when a regeneration is contradicted', async () => {
    // Run 1: a clean, checked page publishes.
    const first = await runGenerate({ repoRoot, runTask: await valueRunner('3'), toolDescriptors: [] });
    expect(first.outcome).toBe('passed');
    const mdxPath = join(repoRoot, 'docs-site', 'content', 'en', 'getting-started.mdx');
    const publishedMdx = await readFile(mdxPath, 'utf8');
    const store = createManifestStore(repoRoot, 'latest');
    const index = await store.readIndex();
    const pageId = index?.pages[0]?.id ?? '';
    const publishedShard = await store.readPageShard({ locale: 'en', pageId });
    const publishedClaimIds = publishedShard?.ledger?.claims.map((claim) => claim.claimId);

    // Run 2: the writer asserts a wrong value on every attempt — after retry exhaustion the
    // candidate is DISCARDED: the published MDX and the shard's trust spine stay byte-for-byte,
    // and an open flag references the rejected candidate.
    const second = await runGenerate({
      repoRoot,
      runTask: await valueRunner('5'),
      toolDescriptors: [],
      maxAttemptsPerPage: 2
    });
    expect(second.outcome).toBe('flagged');
    expect(second.pages[0]?.status).toBe('flagged');

    const mdxAfter = await readFile(mdxPath, 'utf8');
    expect(mdxAfter).toBe(publishedMdx);
    const shardAfter = await store.readPageShard({ locale: 'en', pageId });
    // The retained trust spine: same claims, same correctness — no contradicted state leaked in.
    expect(shardAfter?.ledger?.claims.map((claim) => claim.claimId)).toEqual(publishedClaimIds);
    expect(shardAfter?.ledger?.claims.every((claim) => claim.correctness !== 'contradicted')).toBe(true);
    const rejection = shardAfter?.flags.find(
      (flag) => flag.status === 'open' && flag.summary.includes('previous published page retained')
    );
    expect(rejection).toBeDefined();
    expect(rejection?.detail).toContain('CONTRADICTED');
    expect(rejection?.detail).toContain(second.runId);
  }, 180_000);

  it('flags the page instead of shipping silently when defects persist', async () => {
    const { runTask } = scriptedRunner([badMdx, badMdx]);
    const summary = await runGenerate({ repoRoot, runTask, toolDescriptors: [], maxAttemptsPerPage: 2 });

    expect(summary.outcome).toBe('flagged');
    expect(summary.pages[0]?.status).toBe('flagged');
    const store = createManifestStore(repoRoot, 'latest');
    const index = await store.readIndex();
    const shard = await store.readPageShard({ locale: 'en', pageId: index?.pages[0]?.id ?? '' });
    expect(shard?.flags[0]?.kind).toBe('system');
    expect(shard?.flags[0]?.status).toBe('open');
    // Flagged content still ships — visible, never silent.
    const mdxOnDisk = await readFile(join(repoRoot, 'docs-site', 'content', 'en', 'getting-started.mdx'), 'utf8');
    expect(mdxOnDisk).toContain('greet');
  }, 60_000);
});

describe('unwrapMdxFence', () => {
  it('unwraps a fenced writer response and leaves clean output alone', () => {
    expect(unwrapMdxFence('```mdx\n# Hi\n```')).toBe('# Hi');
    expect(unwrapMdxFence('# Hi')).toBe('# Hi');
  });
});
