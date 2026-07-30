import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { KnowledgeFact, KnowledgeNeed } from '@docstube/contracts';
import {
  canonicalStateJson,
  hashValue,
  knowledgeFactIdSchema,
  knowledgeFactSchema,
  knowledgeNeedIdSchema,
  knowledgeNeedSchema
} from '@docstube/contracts';
import { CoreError } from '../errors.ts';

// The committed tribal-knowledge store (PRODUCT §3.10, dx-knowledge-v2 decision 6): one file per
// KnowledgeNeed and one per KnowledgeFact, named by the record's own stable id.
//
// It replaces `.docstube/knowledge/<sha of the question text>.md`, whose primary key was the
// MODEL'S PHRASING. Consequences of that key, all traced on live runs: two subjects asking
// similarly-worded questions merged into one; a paraphrase of an already-answered question could
// suppress a genuinely new question indefinitely; re-answering overwrote the previous answer with
// no author, timestamp, or history; and nothing ever marked an answer stale when the code it
// described changed. Identity now belongs to the SUBJECT + the missing fact slot, and answers are
// additive.
//
// Serialization is canonical sorted-key JSON, the same rule the manifest store follows for
// machine-owned committed state (harness-state-v2 decision 12), and this is a PUBLIC data format
// at release — hence the schemaVersion envelope on every record.

export const knowledgeDir = (repoRoot: string): string => join(repoRoot, '.docstube', 'knowledge');
const needsDir = (repoRoot: string): string => join(knowledgeDir(repoRoot), 'needs');
const factsDir = (repoRoot: string): string => join(knowledgeDir(repoRoot), 'facts');

export type KnowledgeState = {
  needs: KnowledgeNeed[];
  facts: KnowledgeFact[];
  // Non-fatal integrity notes — currently the pre-v2 `.md` answer files, named individually so a
  // human can see exactly which answers are no longer being injected.
  warnings: string[];
};

export const emptyKnowledgeState = (): KnowledgeState => ({ needs: [], facts: [], warnings: [] });

const readDirEntries = async (dir: string): Promise<string[]> => {
  try {
    return await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
};

// Fail-closed, exactly like the manifest store: a record this store owns that cannot be read back
// is corrupt committed state, not "no knowledge". Silently continuing would drop a maintainer's
// answer and re-ask a question they already answered.
const readRecord = async <T>(path: string, parseValue: (raw: unknown) => T): Promise<T> => {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    throw new CoreError('state-corrupt', `failed to read ${path}: ${(error as Error).message}`, { path });
  }
  try {
    return parseValue(JSON.parse(text));
  } catch (error) {
    throw new CoreError('state-corrupt', `failed to parse ${path}: ${(error as Error).message}`, { path });
  }
};

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export const loadKnowledgeState = async (repoRoot: string): Promise<KnowledgeState> => {
  const warnings: string[] = [];

  // Pre-v2 answer files. They are NOT converted: their durable fields (subject, missing-fact slot,
  // answering author, answer-time revision) were never recorded, so any conversion would fabricate
  // provenance. They are treated as absent and named, so the answer can be re-asked and re-answered
  // with real attribution instead of silently rotting into every writer prompt.
  const legacyFiles = (await readDirEntries(knowledgeDir(repoRoot)))
    .filter((name) => name.endsWith('.md'))
    .toSorted(compare);
  if (legacyFiles.length > 0) {
    warnings.push(
      `.docstube/knowledge/ still holds ${legacyFiles.length} pre-KnowledgeFact answer file(s) — ` +
        `${legacyFiles.join(', ')}. They record no subject, author, or answer-time revision, so they are ` +
        'NOT loaded and not injected into writer prompts. Re-answer the question when it is asked again ' +
        '(`docstube answer`), then delete the file.'
    );
  }

  const needs: KnowledgeNeed[] = [];
  for (const name of (await readDirEntries(needsDir(repoRoot))).toSorted(compare)) {
    if (!name.endsWith('.json')) {
      continue;
    }
    const needId = name.slice(0, -'.json'.length);
    if (!knowledgeNeedIdSchema.safeParse(needId).success) {
      continue;
    }
    const path = join(needsDir(repoRoot), name);
    const need = await readRecord(path, (raw) => knowledgeNeedSchema.parse(raw));
    if (need.needId !== needId) {
      throw new CoreError('state-corrupt', `${path} holds need "${need.needId}" — the file name is its identity`, {
        path
      });
    }
    needs.push(need);
  }

  const facts: KnowledgeFact[] = [];
  for (const name of (await readDirEntries(factsDir(repoRoot))).toSorted(compare)) {
    if (!name.endsWith('.json')) {
      continue;
    }
    const factId = name.slice(0, -'.json'.length);
    if (!knowledgeFactIdSchema.safeParse(factId).success) {
      continue;
    }
    const path = join(factsDir(repoRoot), name);
    const fact = await readRecord(path, (raw) => knowledgeFactSchema.parse(raw));
    if (fact.factId !== factId) {
      throw new CoreError('state-corrupt', `${path} holds fact "${fact.factId}" — the file name is its identity`, {
        path
      });
    }
    facts.push(fact);
  }

  // A fact whose need is gone cannot be explained, attributed to a question, or revalidated.
  const needIds = new Set(needs.map((need) => need.needId));
  const orphans = facts.filter((fact) => !needIds.has(fact.needId));
  if (orphans.length > 0) {
    throw new CoreError(
      'state-corrupt',
      `knowledge fact(s) ${orphans.map((fact) => fact.factId).join(', ')} reference a KnowledgeNeed that is not in ` +
        '.docstube/knowledge/needs/ — the answer has lost the question it answers',
      { repoRoot }
    );
  }

  return { needs: sortNeeds(needs), facts: sortFacts(facts), warnings };
};

export const sortNeeds = (needs: readonly KnowledgeNeed[]): KnowledgeNeed[] =>
  [...needs].toSorted((a, b) => compare(a.createdAt, b.createdAt) || compare(a.needId, b.needId));

export const sortFacts = (facts: readonly KnowledgeFact[]): KnowledgeFact[] =>
  [...facts].toSorted((a, b) => compare(a.answeredAt, b.answeredAt) || compare(a.factId, b.factId));

export const writeKnowledgeNeed = async (repoRoot: string, need: KnowledgeNeed): Promise<void> => {
  const validated = knowledgeNeedSchema.parse(need);
  await mkdir(needsDir(repoRoot), { recursive: true });
  await writeFile(join(needsDir(repoRoot), `${validated.needId}.json`), canonicalStateJson(validated), 'utf8');
};

export const writeKnowledgeFact = async (repoRoot: string, fact: KnowledgeFact): Promise<void> => {
  const validated = knowledgeFactSchema.parse(fact);
  await mkdir(factsDir(repoRoot), { recursive: true });
  await writeFile(join(factsDir(repoRoot), `${validated.factId}.json`), canonicalStateJson(validated), 'utf8');
};

// The one fact a need currently asserts. Superseded facts are retained forever (that IS the
// history), so "the answer" is the single non-superseded one.
export const activeFactForNeed = (facts: readonly KnowledgeFact[], needId: string): KnowledgeFact | undefined =>
  facts.find((fact) => fact.needId === needId && fact.status !== 'superseded');

// Oldest answer first — the supersession chain in the order it was written.
export const factHistoryForNeed = (facts: readonly KnowledgeFact[], needId: string): KnowledgeFact[] =>
  sortFacts(facts.filter((fact) => fact.needId === needId));

// What the writer prompt sees, and what the page records as a consumed dependency.
export type KnowledgeContextFact = {
  factId: string;
  needId: string;
  question: string;
  answer: string;
  // The fact's subject changed materially since it was answered: still the best knowledge there is,
  // but the writer is told not to lean on it and the need is re-asked once.
  stale: boolean;
};

// The dependency hash recorded in ProvenanceV2 (dx-knowledge-v2 decision 8). Status is part of it
// on purpose: a fact flipping to needs-revalidation changes what the writer was told, so the pages
// citing it become dirty and get re-written against the caveat.
export const knowledgeFactFragmentHash = (fact: KnowledgeContextFact): string =>
  hashValue({ statement: fact.answer, stale: fact.stale });

export const knowledgeContextFacts = (state: KnowledgeState): KnowledgeContextFact[] => {
  const needById = new Map(state.needs.map((need) => [need.needId, need]));
  return sortFacts(state.facts)
    .filter((fact) => fact.status !== 'superseded')
    .flatMap((fact) => {
      const need = needById.get(fact.needId);
      return need === undefined
        ? []
        : [
            {
              factId: fact.factId,
              needId: fact.needId,
              question: need.question,
              answer: fact.statement,
              stale: fact.status === 'needs-revalidation'
            }
          ];
    });
};
