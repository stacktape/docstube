import type { Codemap, KnowledgeNeed, KnowledgeSubject } from '@docstube/contracts';
import { sha256Hex, symbolSourceKeySchema } from '@docstube/contracts';

// SLOT IDENTITY — the fix for the failure that shipped: the old store keyed knowledge by a hash of
// the QUESTION TEXT and deduped by global paraphrase similarity, so two different symbols asking
// similarly-worded questions merged into one, and a paraphrase of an answered question could
// suppress a genuinely new question for a different subject indefinitely.
//
// The dedup key is now SUBJECT + KIND-OF-MISSING-FACT (dx-knowledge-v2 decision 6). Text
// similarity never suppresses anything across subjects; inside one subject+slot it only decides
// whether an incoming phrasing is the SAME gap (absorb, ask once) or a different gap (a new need
// with its own discriminated slot). Nothing is ever silently dropped.

const QUESTION_STOPWORDS = new Set(
  'the a an is are was were be been it its this that there no not or and of in on for to with what which who how why should would could can has have had do does did e.g i.e from at by as if but so into than then using used use'.split(
    ' '
  )
);

export const questionTokens = (question: string): Set<string> =>
  new Set((question.toLowerCase().match(/[a-z0-9_./-]+/gu) ?? []).filter((token) => !QUESTION_STOPWORDS.has(token)));

const normalizedQuestion = (question: string): string => question.trim().toLowerCase().replace(/\s+/gu, ' ');

// Retry attempts reword the same gap ("no main/exports — what's the import path?" came back three
// ways in one live run), so exact-text comparison alone triples a maintainer's queue. Containment
// (shared content words over the smaller question) is robust to one phrasing being much longer;
// measured on the live trio it scores 0.56-0.75 versus 0.0-0.13 for genuinely different questions.
// It is applied ONLY within one subject+slot family — never as a global merge.
export const questionsSimilar = (a: string, b: string): boolean => {
  const tokensA = questionTokens(a);
  const tokensB = questionTokens(b);
  const smaller = Math.min(tokensA.size, tokensB.size);
  if (smaller === 0) {
    return false;
  }
  // Containment over-merges very short questions (2 content tokens sharing 1 already scores 0.5),
  // so below that only exact normalized text counts as "the same question".
  if (smaller < 4) {
    return normalizedQuestion(a) === normalizedQuestion(b);
  }
  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) {
      intersection += 1;
    }
  }
  return intersection / smaller >= 0.5;
};

// Stable, short signature of a question's content words. Used ONLY to discriminate two DIFFERENT
// gaps that landed in the same subject+slot family — never as an identity across subjects.
export const questionDiscriminator = (question: string): string =>
  sha256Hex([...questionTokens(question)].toSorted().join(' ')).slice(0, 8);

export const subjectKey = (subject: KnowledgeSubject): string => {
  switch (subject.kind) {
    case 'entity-thread':
      return `entity-thread:${subject.entityThreadId}`;
    case 'symbol':
      return `symbol:${subject.symbolHash}`;
    default:
      return `topic:${subject.topic}`;
  }
};

// Subjects arrive as free text ("greet", "src/retry.ts", "Retry.run"); resolve to a symbol hash
// when the reference is unambiguous. An ambiguous or absent subject stays a topic.
export const resolveSubjectSymbol = (codemap: Codemap, subject: string | undefined): string | undefined => {
  if (subject === undefined) {
    return undefined;
  }
  const needle = subject.trim();
  const dottedTail = needle.split('.').at(-1) ?? needle;
  const matches = codemap.symbols.filter(
    (symbol) => symbol.name === needle || symbol.name === dottedTail || symbol.file === needle
  );
  return matches.length === 1 ? matches[0]?.hash : undefined;
};

const slugify = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 48);

// UNRESOLVED SUBJECTS DEDUP ONLY WITHIN THEIR REQUESTING PAGE. A question whose subject cannot be
// bound to a code symbol carries no cross-page identity, so its topic is explicitly page-scoped
// ("page:<pageId>/<slug>"). The convention is part of the record — the dedup key is a pure function
// of the stored subject, with no hidden context.
export const buildKnowledgeSubject = (input: {
  codemap: Codemap;
  pageId: string;
  subject: string | undefined;
  question: string;
}): KnowledgeSubject => {
  const symbolHash = resolveSubjectSymbol(input.codemap, input.subject);
  if (symbolHash !== undefined) {
    return { kind: 'symbol', symbolHash: symbolSourceKeySchema.parse(symbolHash) };
  }
  const label = slugify(input.subject ?? '') || `q-${questionDiscriminator(input.question)}`;
  return { kind: 'topic', topic: `page:${input.pageId}/${label}` };
};

export type MissingFactSlot = { kind: string; field: string };

// Slot vocabulary the harness advertises. Free-form beyond this list is allowed (the contract only
// requires a kebab-case token) — these are the ones the tool description names so the model has a
// consistent default.
export const MISSING_FACT_KINDS = [
  'rationale',
  'intent',
  'policy',
  'constraint',
  'history',
  'behavior',
  'external',
  'unspecified'
] as const;

const SLOT_KIND_PATTERN = /^[a-z][a-z0-9-]*$/;

export const normalizeMissingFact = (input: {
  kind?: string | undefined;
  field?: string | undefined;
}): MissingFactSlot => {
  const kind = (input.kind ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  const field = (input.field ?? '').trim();
  return {
    kind: SLOT_KIND_PATTERN.test(kind) ? kind : 'unspecified',
    field: field === '' ? 'unspecified' : field
  };
};

const DISCRIMINATOR_SEPARATOR = '#';

export const slotFamilyField = (field: string): string => field.split(DISCRIMINATOR_SEPARATOR)[0] ?? field;

export const slotKey = (subject: KnowledgeSubject, missingFact: MissingFactSlot): string =>
  `${subjectKey(subject)}|${missingFact.kind}|${missingFact.field}`;

export type SlotResolution = { action: 'absorb'; needId: string } | { action: 'create'; missingFact: MissingFactSlot };

// Resolve one captured question against the existing needs:
//   * no need in this subject+slot family        → create with the plain slot
//   * a need in the family asking the SAME gap   → absorb (ask once — including when it is already
//                                                  answered, which is what "ask once" means)
//   * a need in the family asking a DIFFERENT gap → create, discriminated inside the family, so a
//                                                  second genuine question about one subject is
//                                                  never swallowed by the first
export const resolveSlot = (input: {
  needs: readonly KnowledgeNeed[];
  subject: KnowledgeSubject;
  missingFact: MissingFactSlot;
  question: string;
}): SlotResolution => {
  const key = subjectKey(input.subject);
  const family = input.needs.filter(
    (need) =>
      subjectKey(need.subject) === key &&
      need.missingFact.kind === input.missingFact.kind &&
      slotFamilyField(need.missingFact.field) === slotFamilyField(input.missingFact.field)
  );
  if (family.length === 0) {
    return { action: 'create', missingFact: input.missingFact };
  }
  const discriminator = questionDiscriminator(input.question);
  const discriminatedField = `${slotFamilyField(input.missingFact.field)}${DISCRIMINATOR_SEPARATOR}${discriminator}`;
  const sameGap = family.find(
    (need) =>
      need.missingFact.field === discriminatedField ||
      questionDiscriminator(need.question) === discriminator ||
      questionsSimilar(need.question, input.question)
  );
  if (sameGap !== undefined) {
    // A merged need is a pointer; absorb into the need that survived the merge.
    return { action: 'absorb', needId: sameGap.mergedInto ?? sameGap.needId };
  }
  return { action: 'create', missingFact: { kind: input.missingFact.kind, field: discriminatedField } };
};

// Queue-level SUGGESTIONS only (dx-knowledge-v2 decision 6): similar wording across different
// subjects may well be the same underlying gap, but only a human may collapse them — this function
// writes nothing and drops nothing.
export type MergeSuggestion = { needId: string; suggestedMergeInto: string; reason: 'similar-question' };

export const suggestedNeedMerges = (needs: readonly KnowledgeNeed[]): MergeSuggestion[] => {
  const open = needs.filter((need) => need.status === 'open' || need.status === 'escalated');
  const suggestions: MergeSuggestion[] = [];
  for (let i = 0; i < open.length; i += 1) {
    for (let j = 0; j < i; j += 1) {
      const later = open[i]!;
      const earlier = open[j]!;
      if (subjectKey(later.subject) === subjectKey(earlier.subject)) {
        continue;
      }
      if (questionsSimilar(earlier.question, later.question)) {
        suggestions.push({ needId: later.needId, suggestedMergeInto: earlier.needId, reason: 'similar-question' });
        break;
      }
    }
  }
  return suggestions;
};
