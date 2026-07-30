import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { RiskCriticFinding } from '@docstube/contracts';
import { riskCriticFindingSchema } from '@docstube/contracts';

// COST DISCIPLINE FOR THE RISK CRITIC (harness-state-v2 decision 4 + the group assessor's
// decision-7 precedent). The critic is one model call on EVERY page, which makes it the most
// repeated per-page spend in the pipeline — so the pipeline must be able to answer "have I already
// asked this exact question?" without building a task or touching a transport. That is this: a tiny
// content-addressed store under `.docstube/cache/risk-critic/`, keyed by `riskCriticCacheKey`
// (page prose + ledger state + linter spans + brief/persona + prompt version + model).
//
// Machine-local and gitignored, like the rest of `.docstube/cache/` (ARCHITECTURE §5.2): losing it
// costs one model call, never correctness. A corrupt entry is treated as a MISS for the same reason
// — cached state must never be able to fabricate a verdict. Only COMPLETED verdicts are ever
// written: caching a pending/failed run would make one transport hiccup permanently silence a page.

const cachedRiskCriticSchema = z.object({
  schemaVersion: z.literal(1),
  key: z.string().min(1),
  model: z.string().min(1),
  findings: z.array(riskCriticFindingSchema).default([])
});

export type RiskCriticCache = {
  read: (key: string) => Promise<RiskCriticFinding[] | undefined>;
  write: (input: { key: string; model: string; findings: readonly RiskCriticFinding[] }) => Promise<void>;
};

export const riskCriticCacheDir = (repoRoot: string): string => join(repoRoot, '.docstube', 'cache', 'risk-critic');

export const createRiskCriticCache = (repoRoot: string): RiskCriticCache => {
  const dir = riskCriticCacheDir(repoRoot);
  return {
    read: async (key) => {
      let text: string;
      try {
        text = await readFile(join(dir, `${key}.json`), 'utf8');
      } catch {
        return undefined;
      }
      try {
        return cachedRiskCriticSchema.parse(JSON.parse(text)).findings;
      } catch {
        return undefined;
      }
    },
    write: async ({ key, model, findings }) => {
      await mkdir(dir, { recursive: true });
      const payload = cachedRiskCriticSchema.parse({ schemaVersion: 1, key, model, findings });
      await writeFile(join(dir, `${key}.json`), `${JSON.stringify(payload, undefined, 2)}\n`, 'utf8');
    }
  };
};

// An in-memory cache for tests and for callers that deliberately want no persistence.
export const createMemoryRiskCriticCache = (): RiskCriticCache => {
  const entries = new Map<string, RiskCriticFinding[]>();
  return {
    read: async (key) => entries.get(key),
    write: async ({ key, findings }) => {
      entries.set(key, [...findings]);
    }
  };
};
