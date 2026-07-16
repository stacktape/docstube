import { describe, expect, it } from 'vitest';
import type { Codemap, DocstubeConfig, Transcript } from '@docstube/contracts';
import { docstubeConfigSchema, fixtureConfigInput, idPrefixes, mintId, transcriptSchema } from '@docstube/contracts';
import { buildProposeIaTask, proposalsFromTranscript } from './propose-ia.ts';

const fixtureCodemap: Codemap = {
  schemaVersion: 1,
  commit: 'a1b2c3d',
  symbols: [
    {
      hash: `ts:${'0'.repeat(64)}`,
      lang: 'ts',
      kind: 'function',
      name: 'greet',
      containerPath: [],
      file: 'src/greet.ts',
      span: [1, 5],
      visibility: 'public',
      project: '.'
    },
    {
      hash: `ts:${'1'.repeat(64)}`,
      lang: 'ts',
      kind: 'function',
      name: 'internalHelper',
      containerPath: [],
      file: 'src/helper.ts',
      span: [1, 3],
      visibility: 'internal',
      project: '.'
    }
  ]
};

const fixtureConfig: DocstubeConfig = docstubeConfigSchema.parse(fixtureConfigInput);

const structuredTranscript = (value: unknown): Transcript =>
  transcriptSchema.parse({
    schemaVersion: 1,
    taskId: mintId(idPrefixes.task),
    cacheKey: 'test',
    transport: 'replay',
    model: 'replay',
    turns: [],
    usage: {},
    stopReason: 'complete',
    result: { type: 'structured', value }
  });

const proposalTree = (slugPrefix: string) => [
  {
    title: 'Guides',
    slug: `${slugPrefix}-guides`,
    children: [
      { title: 'Install', slug: 'install', brief: 'How to install.', depth: 'overview' },
      { title: 'Usage', slug: 'usage', brief: 'How to use greet.', depth: 'standard' }
    ]
  }
];

const threeProposals = {
  proposals: [
    {
      id: 'task-oriented',
      label: 'Task-oriented',
      rationale: 'Readers come with jobs to do.',
      tree: proposalTree('a')
    },
    { id: 'by-module', label: 'By module', rationale: 'The code has clear module seams.', tree: proposalTree('b') },
    {
      id: 'user-journey',
      label: 'User journey',
      rationale: 'Evaluators need a path from zero to prod.',
      tree: proposalTree('c'),
      pageCountTarget: 12
    }
  ]
};

describe('buildProposeIaTask', () => {
  it('builds a structured propose-ia task grounded in the public codemap surface', () => {
    const task = buildProposeIaTask({ codemap: fixtureCodemap, config: fixtureConfig });
    expect(task.kind).toBe('propose-ia');
    expect(task.output.type).toBe('structured');
    for (const id of ['task-oriented', 'by-module', 'user-journey']) {
      expect(task.systemPrompt).toContain(id);
    }
    expect(task.userPrompt).toContain('greet');
    // Only public symbols reach the prompt.
    expect(task.userPrompt).not.toContain('internalHelper');
    expect(task.tools).toEqual([]);
  });

  it('includes deterministic detection signals when provided', () => {
    const task = buildProposeIaTask({
      codemap: fixtureCodemap,
      config: fixtureConfig,
      detection: {
        languages: ['typescript'],
        frameworks: ['hono'],
        openapiSpecs: ['openapi.yaml'],
        asyncapiSpecs: [],
        monorepo: true
      }
    });
    expect(task.userPrompt).toContain('typescript');
    expect(task.userPrompt).toContain('hono');
    expect(task.userPrompt).toContain('openapi.yaml');
    expect(task.userPrompt).toContain('monorepo: yes');
  });
});

describe('proposalsFromTranscript', () => {
  it('parses three proposals into full Ia documents', () => {
    const result = proposalsFromTranscript(structuredTranscript(threeProposals));
    expect(result.warnings).toEqual([]);
    expect(result.proposals).toHaveLength(3);
    expect(result.proposals.map((proposal) => proposal.id)).toEqual(['task-oriented', 'by-module', 'user-journey']);
    const journey = result.proposals[2];
    expect(journey?.ia.schemaVersion).toBe(1);
    expect(journey?.ia.pageCountTarget).toBe(12);
    expect(journey?.ia.tree[0]?.children?.[0]?.brief).toBe('How to install.');
  });

  it('strips model-invented pageIds instead of rejecting the proposal', () => {
    const decorated = structuredClone(threeProposals) as { proposals: Array<{ tree: Array<Record<string, unknown>> }> };
    decorated.proposals[0]!.tree[0]!['pageId'] = 'totally-not-a-page-id';
    const result = proposalsFromTranscript(structuredTranscript(decorated));
    expect(result.warnings).toEqual([]);
    expect(result.proposals[0]?.ia.tree[0]?.pageId).toBeUndefined();
  });

  it('returns empty proposals with a warning on the wrong count', () => {
    const result = proposalsFromTranscript(structuredTranscript({ proposals: threeProposals.proposals.slice(0, 2) }));
    expect(result.proposals).toEqual([]);
    expect(result.warnings[0]).toMatch(/no valid proposals/);
  });

  it('returns empty proposals with a warning when the task failed outright', () => {
    const failed = transcriptSchema.parse({
      schemaVersion: 1,
      taskId: mintId(idPrefixes.task),
      cacheKey: 'test',
      transport: 'replay',
      model: 'replay',
      turns: [],
      usage: {},
      stopReason: 'error'
    });
    const result = proposalsFromTranscript(failed);
    expect(result.proposals).toEqual([]);
    expect(result.warnings[0]).toMatch(/stop: error/);
  });
});
