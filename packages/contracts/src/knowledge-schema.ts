import { z } from 'zod';
import {
  blockIdSchema,
  claimIdSchema,
  gitShaSchema,
  isoTimestampSchema,
  knowledgeFactIdSchema,
  knowledgeNeedIdSchema,
  lineSpanSchema,
  pageIdSchema,
  repoPathSchema,
  sectionIdSchema,
  sourceKeySchema
} from './primitives.ts';

// KnowledgeNeed + KnowledgeFact (dx-knowledge-v2 decisions 6-7) replace question-text-hash files.
// Needs and facts are records with stable ids, authorship, status, and supersession; dedup key is
// subject + missing-fact slot, never text similarity. Committed knowledge is a public data format
// at release.

// The durable entity thread the subject binds to (trust-model-v2 decision 8 identity threading —
// survives refactors, no re-ask).
const entityThreadIdSchema = z.union([pageIdSchema, sectionIdSchema, blockIdSchema, claimIdSchema]);

// external-world / derivable are auto-answerable by the researcher agent; intent-policy is
// human-only — AI never invents project intent.
export const knowledgeNeedKindSchema = z.enum(['external-world', 'derivable', 'intent-policy']);
export type KnowledgeNeedKind = z.infer<typeof knowledgeNeedKindSchema>;

export const knowledgeNeedStatusSchema = z.enum(['open', 'auto-answered', 'answered', 'merged', 'escalated']);

export const knowledgeNeedSchema = z
  .object({
    needId: knowledgeNeedIdSchema,
    kind: knowledgeNeedKindSchema,
    subject: z.object({
      entityThreadId: entityThreadIdSchema,
      // Revision fingerprint of the code subject at ask time; absent for pure intent questions
      // that bind to no symbol.
      symbolHash: sourceKeySchema.optional()
    }),
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

export const knowledgeFactOriginSchema = z.enum(['human', 'ai']);

export const factEvidenceRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('url'), url: z.url() }),
  z.object({
    kind: z.literal('code'),
    file: repoPathSchema,
    span: lineSpanSchema.optional(),
    symbol: sourceKeySchema.optional()
  })
]);
export type FactEvidenceRef = z.infer<typeof factEvidenceRefSchema>;

// Strict: a project-wide scope must not silently swallow an entity binding (or vice versa) —
// scope drives which pages an accepted fact invalidates.
export const knowledgeFactScopeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('entity'), entityThreadId: entityThreadIdSchema }),
  z.strictObject({ kind: z.literal('project') })
]);
export type KnowledgeFactScope = z.infer<typeof knowledgeFactScopeSchema>;

export const knowledgeFactStatusSchema = z.enum(['active', 'superseded', 'needs-revalidation']);

export const knowledgeFactSchema = z
  .object({
    factId: knowledgeFactIdSchema,
    statement: z.string().min(1),
    origin: knowledgeFactOriginSchema,
    // Human attribution ("github:someuser") or the answering model id.
    author: z.string().min(1),
    evidence: z.array(factEvidenceRefSchema).default([]),
    // Answer-time revision fingerprint: material change → needs-revalidation, ONE targeted re-ask.
    answeredAtRevision: gitShaSchema,
    scope: knowledgeFactScopeSchema,
    status: knowledgeFactStatusSchema,
    supersedes: knowledgeFactIdSchema.optional()
  })
  .superRefine((fact, ctx) => {
    // An uncited confident AI answer counts as failure and escalates (dx-knowledge-v2 decision 7).
    if (fact.origin === 'ai' && fact.evidence.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['evidence'], message: 'origin:ai facts must cite evidence' });
    }
  });
export type KnowledgeFact = z.infer<typeof knowledgeFactSchema>;
