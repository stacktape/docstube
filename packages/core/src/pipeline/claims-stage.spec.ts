import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentTaskSpec, Codemap, Transcript } from '@docstube/contracts';
import { codemapSchema } from '@docstube/contracts';
import type { PageArtifact } from '@docstube/plugin-sdk';
import { extractPageEntity } from '../entities/extract-entities.ts';
import { createRunJournal } from '../state/run-journal.ts';
import { attachExtractedClaims } from './claims-stage.ts';

const mdx = `---
title: Guide
---

# Guide

The \`greet\` function returns a greeting string.

## Removed things

The \`shout\` helper no longer exists but this page still mentions it.
`;

const codemap: Codemap = codemapSchema.parse({
  schemaVersion: 1,
  commit: 'a'.repeat(40),
  symbols: [
    {
      hash: `ts:${'3'.repeat(64)}`,
      lang: 'ts',
      kind: 'function',
      name: 'greet',
      containerPath: ['src', 'greeter'],
      file: 'src/greeter.ts',
      span: [1, 3],
      visibility: 'public',
      project: '.'
    }
  ]
});

const scriptedExtraction =
  (claims: unknown[]) =>
  async (spec: AgentTaskSpec): Promise<Transcript> => ({
    schemaVersion: 1,
    taskId: spec.id,
    cacheKey: 't',
    transport: 'replay',
    model: 's',
    turns: [],
    observedReads: [],
    usage: { inputTokens: 1, outputTokens: 1, cacheHit: false },
    stopReason: 'complete',
    result: { type: 'structured', value: { claims } }
  });

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'docstube-claims-'));
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

const buildArtifact = (): PageArtifact => ({
  page: extractPageEntity({ mdx, slug: 'guide' }),
  mdx,
  mdxPath: 'content/en/guide.mdx',
  locale: 'en',
  version: 'latest'
});

describe('attachExtractedClaims', () => {
  it('proves grounded claims, scores prose, gates stale references, and drops unanchored ones', async () => {
    const journal = await createRunJournal(repoRoot, 'run_00000000000000000000');
    const result = await attachExtractedClaims({
      artifact: buildArtifact(),
      codemap,
      journal,
      runTask: scriptedExtraction([
        {
          text: 'greet returns a greeting string',
          anchor: { quote: 'returns a greeting string' },
          claimClass: 'api-shape',
          identifiers: ['greet']
        },
        {
          text: 'the page is a guide',
          anchor: { quote: 'no longer exists but this page' },
          claimClass: 'factual',
          identifiers: []
        },
        {
          text: 'shout exists',
          anchor: { quote: 'The `shout` helper' },
          claimClass: 'api-shape',
          identifiers: ['shout']
        },
        {
          text: 'phantom claim',
          anchor: { quote: 'this quote appears nowhere' },
          claimClass: 'factual',
          identifiers: []
        }
      ])
    });

    // Stale reference gates like any verifier finding.
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.check).toBe('claim-grounding');
    expect(result.findings[0]?.message).toContain('shout');
    expect(result.attached).toBe(2);
    expect(result.unanchored).toBe(1);

    const blocks = [...result.page.preamble, ...result.page.sections.flatMap((section) => section.blocks)];
    const claims = blocks.flatMap((block) => block.claims);
    expect(claims.map((claim) => claim.guarantee).toSorted()).toEqual(['proven', 'scored']);
  });

  it('never duplicates claims carried from a previous shard', async () => {
    const journal = await createRunJournal(repoRoot, 'run_00000000000000000001');
    const artifact = buildArtifact();
    const first = await attachExtractedClaims({
      artifact,
      codemap,
      journal,
      runTask: scriptedExtraction([
        {
          text: 'greet works',
          anchor: { quote: 'returns a greeting string' },
          claimClass: 'api-shape',
          identifiers: ['greet']
        }
      ])
    });
    const second = await attachExtractedClaims({
      artifact: { ...artifact, page: first.page },
      codemap,
      journal,
      runTask: scriptedExtraction([
        {
          text: 'greet works',
          anchor: { quote: 'returns a greeting string' },
          claimClass: 'api-shape',
          identifiers: ['greet']
        }
      ])
    });
    expect(second.attached).toBe(0);
    const blocks = [...second.page.preamble, ...second.page.sections.flatMap((section) => section.blocks)];
    expect(blocks.flatMap((block) => block.claims)).toHaveLength(1);
  });
});
