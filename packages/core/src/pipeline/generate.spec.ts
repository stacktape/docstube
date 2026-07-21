import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanClaimMarkers } from '@docstube/agent-runtime';
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
    // The clean ts snippet is proven by code-typecheck-ts.
    const codeBlock = shard?.page.sections
      .flatMap((section) => section.blocks)
      .find((block) => block.blockType === 'code-example');
    expect(codeBlock?.guarantee).toBe('proven');
    // The kernel anchored the writer-authored ledger claim to its marker's block and the bridge
    // derived the legacy view: unchecked ledger claims surface as 'scored' until verification
    // (wave 2b-ii) flips correctness. No post-hoc extraction task ran on the generate path.
    const markerBlock = shard?.page.preamble[0];
    expect(markerBlock?.claims).toHaveLength(1);
    expect(markerBlock?.claims[0]).toMatchObject({ claimClass: 'code-structure', guarantee: 'scored' });
    expect(markerBlock?.claims[0]?.id).toMatch(/^cl_/);
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
    // Untranslated code keeps its proven guarantee in the translation.
    const deCode = deShard?.page.sections
      .flatMap((section) => section.blocks)
      .find((block) => block.blockType === 'code-example');
    expect(deCode?.guarantee).toBe('proven');
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

  it('regeneration of unchanged MDX keeps the claim id but NEVER carries old trust (review repro)', async () => {
    // First run establishes the shard, then the stored claim is lifted to 'proven' to simulate a
    // previous run's trust state (the exact reproduction from the wave 2b-i gate review: a
    // dependency-triggered regeneration must not ship a second claim identity, must not carry the
    // old guarantee, and must not let stale proven claims lift the block).
    const first = await runGenerate({ repoRoot, toolDescriptors: [], runTask: scriptedRunner([goodMdx]).runTask });
    expect(first.outcome).toBe('passed');

    const store = createManifestStore(repoRoot, 'latest');
    const index = await store.readIndex();
    const pageId = index?.pages[0]?.id ?? '';
    const shard = await store.readPageShard({ locale: 'en', pageId });
    const previousClaimId = shard?.page.preamble[0]?.claims[0]?.id;
    expect(previousClaimId).toMatch(/^cl_/);
    if (shard === undefined) {
      throw new Error('expected a shard');
    }
    await store.writePageShard({
      ...shard,
      page: {
        ...shard.page,
        preamble: [
          {
            ...shard.page.preamble[0]!,
            guarantee: 'proven',
            claims: shard.page.preamble[0]!.claims.map((claim) => ({ ...claim, guarantee: 'proven' as const }))
          },
          ...shard.page.preamble.slice(1)
        ]
      }
    });

    // Second run: unchanged MDX regenerates (generate always rewrites).
    const second = await runGenerate({ repoRoot, toolDescriptors: [], runTask: scriptedRunner([goodMdx]).runTask });
    expect(second.outcome).toBe('passed');
    const regenerated = await store.readPageShard({ locale: 'en', pageId });
    const markerBlock = regenerated?.page.preamble[0];
    // ONE claim identity: the ledger-anchored claim reuses the previous shard's claim id.
    expect(markerBlock?.claims).toHaveLength(1);
    expect(markerBlock?.claims[0]?.id).toBe(previousClaimId);
    // Trust does NOT carry: the claim is back to 'scored' (unchecked), and the stale 'proven'
    // claim no longer lifts the block.
    expect(markerBlock?.claims[0]?.guarantee).toBe('scored');
    expect(markerBlock?.guarantee).toBe('scored');
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
