import { z } from 'zod';
import {
  contentHashSchema,
  entityThreadIdSchema,
  isoTimestampSchema,
  knowledgeFactIdSchema,
  knowledgeNeedIdSchema,
  lineSpanSchema,
  pageIdSchema,
  repoPathSchema,
  symbolSourceKeySchema
} from './primitives.ts';

// KnowledgeNeed + KnowledgeFact (dx-knowledge-v2 decisions 6-8) replace question-text-hash files.
// Needs and facts are records with stable ids, authorship, status, and supersession; dedup key is
// subject + missing-fact slot, never text similarity. Committed knowledge is a public data format
// at release — hence the explicit schemaVersion envelope on both records.

// What the need/fact is about. A subject is exactly one of: the durable entity thread
// (trust-model-v2 decision 8 — survives refactors, no re-ask), a code symbol with no docs entity
// yet, or a free-standing topic (project-wide intent that binds to no code).
export const knowledgeSubjectSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('entity-thread'),
    entityThreadId: entityThreadIdSchema,
    // Revision fingerprint of the bound code subject at ask time, when one exists.
    symbolHash: symbolSourceKeySchema.optional()
  }),
  z.strictObject({ kind: z.literal('symbol'), symbolHash: symbolSourceKeySchema }),
  z.strictObject({ kind: z.literal('topic'), topic: z.string().min(1) })
]);
export type KnowledgeSubject = z.infer<typeof knowledgeSubjectSchema>;

// external-world / derivable are auto-answerable by the researcher agent; intent-policy is
// human-only — AI never invents project intent.
export const knowledgeNeedKindSchema = z.enum(['external-world', 'derivable', 'intent-policy']);
export type KnowledgeNeedKind = z.infer<typeof knowledgeNeedKindSchema>;

export const knowledgeNeedStatusSchema = z.enum(['open', 'auto-answered', 'answered', 'merged', 'escalated']);

export const factEvidenceRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('url'), url: z.url() }),
  z.object({
    kind: z.literal('code'),
    file: repoPathSchema,
    span: lineSpanSchema.optional(),
    symbol: symbolSourceKeySchema.optional()
  })
]);
export type FactEvidenceRef = z.infer<typeof factEvidenceRefSchema>;

// One auto-answer research attempt: which model tried, what it consulted, what it concluded.
// Escalated needs carry the trail so humans answer faster (dx-knowledge-v2 decision 7).
export const researchAttemptSchema = z.object({
  attemptedBy: z.string().min(1),
  at: isoTimestampSchema,
  sourcesConsulted: z.array(factEvidenceRefSchema).default([]),
  summary: z.string().optional()
});
export type ResearchAttempt = z.infer<typeof researchAttemptSchema>;

export const knowledgeNeedSchema = z
  .object({
    schemaVersion: z.literal(1),
    needId: knowledgeNeedIdSchema,
    kind: knowledgeNeedKindSchema,
    subject: knowledgeSubjectSchema,
    // The dedup slot: what kind of fact is missing and which field of it.
    missingFact: z.object({
      kind: z.string().regex(/^[a-z][a-z0-9-]*$/),
      field: z.string().min(1)
    }),
    requestingPages: z.array(pageIdSchema).default([]),
    // The original question as asked — preserved verbatim; merges never rewrite it.
    question: z.string().min(1),
    status: knowledgeNeedStatusSchema,
    mergedInto: knowledgeNeedIdSchema.optional(),
    // Auto-answer attempts recorded on the need so escalation carries the research.
    researchTrail: z.array(researchAttemptSchema).default([]),
    createdAt: isoTimestampSchema
  })
  .superRefine((need, ctx) => {
    if (need.status === 'merged' && need.mergedInto === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['mergedInto'],
        message: 'a merged need must reference the surviving need'
      });
    }
  });
export type KnowledgeNeed = z.infer<typeof knowledgeNeedSchema>;

// 'ai' = the researcher agent (must cite evidence); 'user' = CLI/local-UI answer;
// 'github-answer' = an ingested `/answer` reply from a write-access author.
export const knowledgeFactOriginSchema = z.enum(['ai', 'user', 'github-answer']);

// Strict: a project-wide scope must not silently swallow an entity binding (or vice versa) —
// scope drives which pages an accepted fact invalidates.
export const knowledgeFactScopeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('entity'), entityThreadId: entityThreadIdSchema }),
  z.strictObject({ kind: z.literal('project') })
]);
export type KnowledgeFactScope = z.infer<typeof knowledgeFactScopeSchema>;

export const knowledgeFactStatusSchema = z.enum(['active', 'superseded', 'needs-revalidation']);

// Propagation is a separate axis from lifecycle status (dx-knowledge-v2 decision 8): an answer is
// saved ('answered'), its dependent pages are queued ('propagation-pending'), then regenerated
// ('applied') — visible status, never silent waiting.
export const knowledgeFactPropagationSchema = z.enum(['answered', 'propagation-pending', 'applied']);

export const knowledgeFactSchema = z
  .object({
    schemaVersion: z.literal(1),
    factId: knowledgeFactIdSchema,
    // The need this fact answers.
    needId: knowledgeNeedIdSchema,
    statement: z.string().min(1),
    origin: knowledgeFactOriginSchema,
    // Attribution: "github:someuser" for user/github-answer origins, the model id for ai.
    author: z.string().min(1),
    evidence: z.array(factEvidenceRefSchema).default([]),
    answeredAt: isoTimestampSchema,
    // Content fingerprint of the subject at answer time (content-derived, never a git commit):
    // material change → needs-revalidation, ONE targeted re-ask.
    subjectFingerprint: contentHashSchema,
    // The auto-answerer's research trail when the fact was AI-produced.
    researchTrail: z.array(researchAttemptSchema).default([]),
    scope: knowledgeFactScopeSchema,
    status: knowledgeFactStatusSchema,
    propagation: knowledgeFactPropagationSchema,
    supersedes: knowledgeFactIdSchema.optional()
  })
  .superRefine((fact, ctx) => {
    // An uncited confident AI answer counts as failure and escalates (dx-knowledge-v2 decision 7).
    if (fact.origin === 'ai' && fact.evidence.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['evidence'], message: 'origin:ai facts must cite evidence' });
    }
  });
export type KnowledgeFact = z.infer<typeof knowledgeFactSchema>;
