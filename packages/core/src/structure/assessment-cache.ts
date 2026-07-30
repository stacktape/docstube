import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { pageIdSchema } from '@docstube/contracts';
import { structuralAssessmentOutcomes } from './group-assessor.ts';
import type { GroupAssessment } from './group-assessor.ts';

// COST DISCIPLINE (quality-ci-reader-v2 decision 7). The group assessor is the only model call the
// structure pass makes, so the pass must be able to answer "have I already asked this exact
// question?" WITHOUT building a task or touching a transport. That is what this is: a tiny
// content-addressed store under `.docstube/cache/structure/`, keyed by
// `groupAssessmentCacheKey` (IA/group plan + member outline hashes + detector/prompt version +
// model).
//
// Machine-local and gitignored, like the rest of `.docstube/cache/` (ARCHITECTURE §5.2): losing it
// costs one model call, never correctness. A corrupt entry is treated as a miss for the same
// reason — cached state must never be able to fabricate a verdict.

const cachedAssessmentSchema = z.object({
  schemaVersion: z.literal(1),
  key: z.string().min(1),
  model: z.string().min(1),
  assessments: z
    .array(
      z.object({
        pageId: pageIdSchema,
        outcome: z.enum(structuralAssessmentOutcomes),
        reasoning: z.string().min(1)
      })
    )
    .default([])
});

export type StructuralAssessmentCache = {
  read: (key: string) => Promise<GroupAssessment[] | undefined>;
  write: (input: { key: string; model: string; assessments: readonly GroupAssessment[] }) => Promise<void>;
};

export const structureCacheDir = (repoRoot: string): string => join(repoRoot, '.docstube', 'cache', 'structure');

export const createStructuralAssessmentCache = (repoRoot: string): StructuralAssessmentCache => {
  const dir = structureCacheDir(repoRoot);
  return {
    read: async (key) => {
      let text: string;
      try {
        text = await readFile(join(dir, `${key}.json`), 'utf8');
      } catch {
        return undefined;
      }
      try {
        return cachedAssessmentSchema.parse(JSON.parse(text)).assessments;
      } catch {
        return undefined;
      }
    },
    write: async ({ key, model, assessments }) => {
      await mkdir(dir, { recursive: true });
      const payload = cachedAssessmentSchema.parse({ schemaVersion: 1, key, model, assessments });
      await writeFile(join(dir, `${key}.json`), `${JSON.stringify(payload, undefined, 2)}\n`, 'utf8');
    }
  };
};

// An in-memory cache for tests and for callers that deliberately want no persistence.
export const createMemoryAssessmentCache = (): StructuralAssessmentCache => {
  const entries = new Map<string, GroupAssessment[]>();
  return {
    read: async (key) => entries.get(key),
    write: async ({ key, assessments }) => {
      entries.set(key, [...assessments]);
    }
  };
};
