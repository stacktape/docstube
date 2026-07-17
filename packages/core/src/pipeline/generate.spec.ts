import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentTaskSpec, Transcript } from '@docstube/contracts';
import { createManifestStore } from '../state/manifest-store.ts';
import { runGenerate, unwrapMdxFence } from './generate.ts';

// End-to-end pipeline test over a real temp repo with the real builtin plugins (verifiers +
// lang-typescript). The writer and reviewers are a scripted TaskRunner — CI never calls a live
// model.

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

The library exposes a single \`greet\` function.

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
    if (spec.kind === 'audit-extract-claims') {
      const base = baseTranscript(spec);
      return {
        ...base,
        observedReads: [],
        turns: [],
        result: {
          type: 'structured',
          value: {
            claims: [
              {
                text: 'The library exposes a single greet function.',
                anchor: { quote: 'exposes a single `greet` function' },
                claimClass: 'api-shape',
                identifiers: ['greet']
              }
            ]
          }
        }
      };
    }
    writeCalls.push(spec);
    const mdx = remaining.shift();
    if (mdx === undefined) {
      throw new Error('scripted runner exhausted');
    }
    return {
      ...baseTranscript(spec),
      turns: [{ role: 'assistant', blocks: [{ type: 'text', text: mdx }] }],
      result: { type: 'mdx', mdx }
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
    // The claims stage anchored the extracted claim to its paragraph and proved it via the
    // codemap (identifier `greet` exists).
    const paragraph = shard?.page.preamble[0];
    expect(paragraph?.claims).toHaveLength(1);
    expect(paragraph?.claims[0]).toMatchObject({ claimClass: 'api-shape', guarantee: 'proven' });
  }, 60_000);

  it('retries on verifier findings and passes with the fixed draft', async () => {
    const { runTask, writeCalls } = scriptedRunner([badMdx, goodMdx]);
    const summary = await runGenerate({ repoRoot, runTask, toolDescriptors: [] });

    expect(writeCalls).toHaveLength(2);
    // The retry prompt carries the findings forward.
    expect(writeCalls[1]?.userPrompt).toContain('FAILED verification');
    expect(writeCalls[1]?.userPrompt).toContain('code-typecheck-ts');
    expect(summary.outcome).toBe('passed');
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
      if (spec.kind === 'audit-extract-claims') {
        return {
          ...baseTranscript(spec),
          observedReads: [],
          turns: [],
          result: { type: 'structured', value: { claims: [] } }
        };
      }
      const mdx = remaining.shift();
      if (mdx === undefined) {
        throw new Error('exhausted');
      }
      return {
        ...baseTranscript(spec),
        turns: [{ role: 'assistant', blocks: [{ type: 'text', text: mdx }] }],
        result: { type: 'mdx', mdx }
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
      if (spec.kind === 'audit-extract-claims') {
        return {
          ...baseTranscript(spec),
          observedReads: [],
          turns: [],
          result: { type: 'structured', value: { claims: [] } }
        };
      }
      const mdx = spec.kind === 'translate-page' ? germanMdx : goodMdx;
      return {
        ...baseTranscript(spec),
        turns: [{ role: 'assistant', blocks: [{ type: 'text', text: mdx }] }],
        result: { type: 'mdx', mdx }
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
      if (spec.kind === 'audit-extract-claims') {
        return {
          ...baseTranscript(spec),
          observedReads: [],
          turns: [],
          result: { type: 'structured', value: { claims: [] } }
        };
      }
      const mdx = spec.kind === 'translate-page' ? brokenTranslation : goodMdx;
      return {
        ...baseTranscript(spec),
        turns: [{ role: 'assistant', blocks: [{ type: 'text', text: mdx }] }],
        result: { type: 'mdx', mdx }
      };
    };
    const summary = await runGenerate({ repoRoot, runTask, toolDescriptors: [] });
    expect(summary.outcome).toBe('flagged');
    expect(summary.translations[0]?.status).toBe('flagged');
    expect(summary.translations[0]?.findings[0]?.check).toBe('translation-structure');
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
