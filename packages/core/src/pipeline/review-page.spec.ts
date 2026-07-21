import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { docstubeConfigSchema, glossarySchema, idPrefixes, mintId, transcriptSchema } from '@docstube/contracts';
import type { ReviewResult, Transcript } from '@docstube/contracts';
import type { PageArtifact } from '@docstube/plugin-sdk';
import { createRunJournal } from '../state/run-journal.ts';
import type { RunJournal } from '../state/run-journal.ts';
import { reviewPage } from './review-page.ts';

// The reviewed label rests on reviews that GENUINELY completed: a structurally valid review with
// zero evaluated criteria proves nothing was evaluated and must never count as completed
// (impl-08 new defect — the personaReview schema also rejects completed-with-empty-criteria).

const config = docstubeConfigSchema.parse({
  schemaVersion: 1,
  docType: 'external-library',
  personas: [{ id: 'app-developer', description: 'Builds apps on the library' }],
  site: { title: 'Docs' }
});

const glossary = glossarySchema.parse({ schemaVersion: 1, terms: [] });
void glossary;

const artifact: PageArtifact = {
  page: {
    id: `pg_${'1'.repeat(20)}`,
    kind: 'page',
    slug: 'retry',
    title: 'Retry',
    preamble: [],
    sections: [],
    guarantee: 'scored',
    provenance: { sources: [], seedContext: [], observedReads: [], verifications: [], reviews: [] }
  },
  mdx: '# Retry\n\nBody.\n',
  mdxPath: 'content/en/retry.mdx',
  locale: 'en',
  version: 'latest'
};

const transcriptWith = (review: ReviewResult): Transcript =>
  transcriptSchema.parse({
    schemaVersion: 1,
    taskId: `tk_${'2'.repeat(20)}`,
    cacheKey: 'test',
    transport: 'replay',
    model: 'reviewer-model',
    turns: [],
    observedReads: [],
    usage: { inputTokens: 1, outputTokens: 1, cacheHit: false },
    stopReason: 'complete',
    result: { type: 'structured', value: review }
  });

let repoRoot: string;
let journal: RunJournal;

beforeAll(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'docstube-review-page-'));
  journal = await createRunJournal(repoRoot, mintId(idPrefixes.run));
});

afterAll(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

const runReview = (review: ReviewResult) =>
  reviewPage({
    config,
    criteria: [],
    artifact,
    primaryPersona: 'app-developer',
    runTask: async () => transcriptWith(review),
    journal
  });

describe('reviewPage completion', () => {
  it('marks a review with evaluated criteria as completed', async () => {
    const reviews = await runReview({
      persona: 'app-developer',
      criteria: [{ criterion: 'audience-fit', outcome: 'met', reasoning: 'fits the persona' }],
      findings: []
    });
    expect(reviews[0]).toMatchObject({ completed: true, persona: 'app-developer' });
  });

  it('NEVER marks an empty-criteria review as completed — the reviewed label cannot be earned by it (impl-08)', async () => {
    const reviews = await runReview({ persona: 'app-developer', criteria: [], findings: [] });
    expect(reviews[0]?.completed).toBe(false);
    // The skipped review is a recorded fact with a visible warning, never a silent pass.
    expect(reviews[0]?.findings.some((finding) => finding.severity === 'warning')).toBe(true);
  });
});
