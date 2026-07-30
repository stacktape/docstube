import type { AgentTaskSpec, IaNodeV2, PageShard, StructuralSnapshotPage, Transcript } from '@docstube/contracts';
import { contentHash, contentHashSchema, idPrefixes, mintId } from '@docstube/contracts';
import { outlineHashOf } from './structural-snapshot.ts';

// Shared fixtures for the structure-pass tests. Pages are built from section TITLES only, because
// that is the entire input the outline matrix reasons over — anything richer would make the tests
// prove something the detectors do not actually read.

export type FixturePageInput = {
  slug: string;
  title?: string;
  brief?: string;
  primaryPersona?: string;
  // Section titles, each with a paragraph body unless listed in `emptySections`.
  sections: readonly string[];
  emptySections?: readonly string[];
  structureProfile?: string;
  structuralExceptions?: readonly string[];
};

export const buildStructurePageShard = (input: FixturePageInput, pageId = mintId(idPrefixes.page)): PageShard => {
  const empty = new Set(input.emptySections ?? []);
  const page = {
    id: pageId,
    kind: 'page' as const,
    slug: input.slug,
    title: input.title ?? input.slug,
    preamble: [],
    sections: input.sections.map((title, index) => ({
      id: mintId(idPrefixes.section),
      kind: 'section' as const,
      title,
      level: 2,
      anchor: `${title.toLowerCase().replaceAll(/[^a-z0-9]+/gu, '-')}-${index}`,
      blocks: empty.has(title)
        ? []
        : [
            {
              id: mintId(idPrefixes.block),
              kind: 'block' as const,
              blockType: 'paragraph',
              contentHash: contentHash(`${input.slug}:${title}`),
              variants: [],
              provenance: { sources: [], seedContext: [], observedReads: [], verifications: [], reviews: [] }
            }
          ]
    })),
    provenance: { sources: [], seedContext: [], observedReads: [], verifications: [], reviews: [] }
  };
  return {
    schemaVersion: 2,
    locale: 'en',
    version: 'latest',
    sourceCommit: 'a'.repeat(40),
    generatedAt: '2026-07-12T00:00:00.000Z',
    page,
    mdxContentHash: contentHashSchema.parse(contentHash(`${input.slug}:${input.sections.join('|')}`)),
    flags: [],
    structuralFindings: []
  };
};

export const buildIaPageNode = (input: FixturePageInput): IaNodeV2 => ({
  kind: 'page',
  slug: input.slug,
  title: input.title ?? input.slug,
  brief: input.brief ?? `Documents the ${input.slug} resource.`,
  primaryPersona: input.primaryPersona ?? 'operator',
  ...(input.structureProfile === undefined ? {} : { structureProfile: input.structureProfile }),
  ...(input.structuralExceptions === undefined ? {} : { structuralExceptions: [...input.structuralExceptions] }),
  depth: 'standard'
});

export const buildSnapshotPage = (
  input: FixturePageInput & { pageId?: string; groupId?: string }
): StructuralSnapshotPage => {
  const outline = input.sections.map((title) => ({
    title,
    level: 2,
    blockTypes: (input.emptySections ?? []).includes(title) ? [] : ['paragraph']
  }));
  return {
    pageId: input.pageId ?? mintId(idPrefixes.page),
    ...(input.groupId === undefined ? {} : { groupId: input.groupId }),
    brief: input.brief ?? `Documents the ${input.slug} resource.`,
    primaryPersona: input.primaryPersona ?? 'operator',
    ...(input.structureProfile === undefined ? {} : { structureProfile: input.structureProfile }),
    structuralExceptions: [...(input.structuralExceptions ?? [])],
    outlineHash: outlineHashOf(outline),
    outline,
    blockSummary: [],
    claimSubjects: []
  };
};

// A scripted assessor: returns the given verdicts for the `assess-group-structure` task and throws
// on anything else, so a test that accidentally makes a second model call fails loudly.
export const scriptedAssessor = (
  verdicts: ReadonlyMap<string, 'expected' | 'not-applicable' | 'uncertain'>
): { runTask: (spec: AgentTaskSpec) => Promise<Transcript>; calls: AgentTaskSpec[] } => {
  const calls: AgentTaskSpec[] = [];
  return {
    calls,
    runTask: async (spec) => {
      if (spec.kind !== 'assess-group-structure') {
        throw new Error(`unexpected task kind ${spec.kind}`);
      }
      calls.push(spec);
      return {
        schemaVersion: 1,
        taskId: spec.id,
        cacheKey: 'test',
        transport: 'replay',
        model: 'scripted-architect',
        turns: [],
        observedReads: [],
        usage: { inputTokens: 1, outputTokens: 1, cacheHit: false },
        stopReason: 'complete',
        result: {
          type: 'structured',
          value: {
            assessments: [...verdicts.entries()].map(([pageId, outcome]) => ({
              pageId,
              outcome,
              reasoning: `scripted ${outcome}`
            }))
          }
        }
      };
    }
  };
};
