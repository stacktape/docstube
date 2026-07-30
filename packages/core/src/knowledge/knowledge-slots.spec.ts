import { describe, expect, it } from 'vitest';
import type { Codemap, KnowledgeNeed, KnowledgeSubject } from '@docstube/contracts';
import { codemapSchema, idPrefixes, knowledgeNeedSchema, mintId, sha256Hex } from '@docstube/contracts';
import {
  buildKnowledgeSubject,
  normalizeMissingFact,
  questionsSimilar,
  resolveSlot,
  slotKey,
  subjectKey,
  suggestedNeedMerges
} from './knowledge-slots.ts';

// THE FAILURE THAT SHIPPED: identity was a hash of the QUESTION TEXT and dedup was global
// paraphrase similarity, so two subjects asking similarly-worded questions merged into one, and a
// paraphrase of an answered question could suppress a genuinely new question forever. Identity is
// now subject + missing-fact slot.

const PAGE_A = `pg_${'1'.repeat(20)}`;
const PAGE_B = `pg_${'2'.repeat(20)}`;

const symbolHash = (name: string): string => `ts:${sha256Hex(name)}`;

const codemap: Codemap = codemapSchema.parse({
  schemaVersion: 1,
  commit: 'abc1234',
  symbols: ['greet', 'farewell'].map((name, index) => ({
    hash: symbolHash(name),
    lang: 'ts',
    kind: 'function',
    name,
    containerPath: ['src', 'greeter'],
    file: 'src/greeter.ts',
    span: [index + 1, index + 1],
    visibility: 'public',
    project: '.'
  }))
});

const makeNeed = (input: {
  subject: KnowledgeSubject;
  question: string;
  field?: string;
  status?: KnowledgeNeed['status'];
}): KnowledgeNeed =>
  knowledgeNeedSchema.parse({
    schemaVersion: 1,
    needId: mintId(idPrefixes.knowledgeNeed),
    kind: 'intent-policy',
    subject: input.subject,
    missingFact: { kind: 'unspecified', field: input.field ?? 'unspecified' },
    requestingPages: [PAGE_A],
    question: input.question,
    status: input.status ?? 'open',
    createdAt: '2026-01-01T00:00:00.000Z'
  });

// Two symbols, one shared question shape. Under the old text-hash + global-similarity dedup these
// merged into a single question and one of the two subjects silently never got asked about.
const greetQuestion = 'Why does greet accept a loud option instead of exposing a separate shout helper function?';
const farewellQuestion = 'Why does farewell accept a loud option instead of exposing a separate shout helper function?';

describe('subject identity', () => {
  it('keeps two different subjects apart even when their questions are near-identical', () => {
    const greet = buildKnowledgeSubject({ codemap, pageId: PAGE_A, subject: 'greet', question: greetQuestion });
    const farewell = buildKnowledgeSubject({
      codemap,
      pageId: PAGE_A,
      subject: 'farewell',
      question: farewellQuestion
    });
    expect(questionsSimilar(greetQuestion, farewellQuestion)).toBe(true);
    expect(subjectKey(greet)).not.toBe(subjectKey(farewell));

    const needs = [makeNeed({ subject: greet, question: greetQuestion })];
    const resolution = resolveSlot({
      needs,
      subject: farewell,
      missingFact: normalizeMissingFact({}),
      question: farewellQuestion
    });
    // BOTH survive: similarity may never cross a subject boundary.
    expect(resolution.action).toBe('create');
  });

  it('an ANSWERED need never suppresses a new need for a different subject', () => {
    const greet = buildKnowledgeSubject({ codemap, pageId: PAGE_A, subject: 'greet', question: greetQuestion });
    const farewell = buildKnowledgeSubject({
      codemap,
      pageId: PAGE_A,
      subject: 'farewell',
      question: farewellQuestion
    });
    const answered = [makeNeed({ subject: greet, question: greetQuestion, status: 'answered' })];
    expect(
      resolveSlot({
        needs: answered,
        subject: farewell,
        missingFact: normalizeMissingFact({}),
        question: `In other words: ${farewellQuestion}`
      }).action
    ).toBe('create');
  });

  it('binds an unresolvable subject to its requesting page, so it dedups only there', () => {
    const onPageA = buildKnowledgeSubject({
      codemap,
      pageId: PAGE_A,
      subject: 'some-runtime-behaviour',
      question: greetQuestion
    });
    const onPageB = buildKnowledgeSubject({
      codemap,
      pageId: PAGE_B,
      subject: 'some-runtime-behaviour',
      question: greetQuestion
    });
    expect(onPageA.kind).toBe('topic');
    expect(subjectKey(onPageA)).not.toBe(subjectKey(onPageB));
    expect(
      resolveSlot({
        needs: [makeNeed({ subject: onPageA, question: greetQuestion })],
        subject: onPageA,
        missingFact: normalizeMissingFact({}),
        question: greetQuestion
      }).action
    ).toBe('absorb');
  });
});

describe('slot dedup', () => {
  const greet = buildKnowledgeSubject({ codemap, pageId: PAGE_A, subject: 'greet', question: greetQuestion });

  it('absorbs a rewording of the SAME gap about the SAME subject — ask once', () => {
    // The three phrasings a live claude run produced for one gap; here they share a subject.
    const reworded = 'What was the reason a loud option was added to greet rather than a separate shout function?';
    const resolution = resolveSlot({
      needs: [makeNeed({ subject: greet, question: greetQuestion })],
      subject: greet,
      missingFact: normalizeMissingFact({}),
      question: reworded
    });
    expect(resolution.action).toBe('absorb');
  });

  it('creates a discriminated slot for a DIFFERENT gap about the same subject — never a silent drop', () => {
    const resolution = resolveSlot({
      needs: [makeNeed({ subject: greet, question: greetQuestion })],
      subject: greet,
      missingFact: normalizeMissingFact({}),
      question: 'Which locales is greet expected to support, and who decides when a new one is added?'
    });
    expect(resolution.action).toBe('create');
    const missingFact = resolution.action === 'create' ? resolution.missingFact : normalizeMissingFact({});
    expect(missingFact.field).toMatch(/^unspecified#[0-9a-f]{8}$/);
    // A distinct durable slot, not a phrasing-keyed one: re-asking it later lands on this need.
    expect(slotKey(greet, missingFact)).not.toBe(slotKey(greet, normalizeMissingFact({})));
  });

  it('keeps explicit slots apart from each other', () => {
    const needs = [makeNeed({ subject: greet, question: greetQuestion, field: 'deprecation-reason' })];
    expect(
      resolveSlot({
        needs,
        subject: greet,
        missingFact: normalizeMissingFact({ kind: 'policy', field: 'support-window' }),
        question: greetQuestion
      }).action
    ).toBe('create');
  });

  it('normalizes a slot kind the model made up, and never produces an invalid one', () => {
    expect(normalizeMissingFact({ kind: 'Why It Exists', field: '  ' })).toEqual({
      kind: 'why-it-exists',
      field: 'unspecified'
    });
    expect(normalizeMissingFact({ kind: '???' }).kind).toBe('unspecified');
  });
});

describe('suggestedNeedMerges', () => {
  it('SUGGESTS a cross-subject merge without discarding either need', () => {
    const greet = buildKnowledgeSubject({ codemap, pageId: PAGE_A, subject: 'greet', question: greetQuestion });
    const farewell = buildKnowledgeSubject({
      codemap,
      pageId: PAGE_A,
      subject: 'farewell',
      question: farewellQuestion
    });
    const needs = [
      makeNeed({ subject: greet, question: greetQuestion }),
      makeNeed({ subject: farewell, question: farewellQuestion })
    ];
    const suggestions = suggestedNeedMerges(needs);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({ needId: needs[1]?.needId, suggestedMergeInto: needs[0]?.needId });
    // Suggestion only — both needs are untouched and still open.
    expect(needs.every((need) => need.status === 'open' && need.mergedInto === undefined)).toBe(true);
  });
});
