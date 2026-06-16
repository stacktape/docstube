import { z } from 'zod';
import { identifierSchema, severitySchema } from './primitives.ts';

// Criteria checklist schema for `.docstube/criteria/`.
//
// Criteria are committed, human-editable checklists that persona reviewers and doc-type reviews
// evaluate. Each item is a yes/no statement, optionally carrying the severity a failure should
// produce. Criteria never define numeric scores (PLAN.md).

export const criteriaScopes = ['persona', 'doc-type', 'global'] as const;

export const criteriaScopeSchema = z.enum(criteriaScopes);

export type CriteriaScope = z.infer<typeof criteriaScopeSchema>;

export const criteriaItemSchema = z.strictObject({
  id: identifierSchema,
  // The statement a reviewer evaluates, phrased so that "yes" is the desired outcome.
  statement: z.string().min(1, { error: 'criteria statement must not be empty' }),
  // Severity assigned to a finding when this item fails. Defaults to major.
  severity: severitySchema.default('major'),
  guidance: z.string().optional()
});

export type CriteriaItem = z.infer<typeof criteriaItemSchema>;

export const criteriaChecklistSchema = z
  .strictObject({
    version: z.literal(1).default(1),
    id: identifierSchema,
    title: z.string().min(1, { error: 'criteria title must not be empty' }),
    scope: criteriaScopeSchema,
    // Persona ID or doc type the checklist applies to. Required for scoped checklists.
    target: identifierSchema.optional(),
    items: z.array(criteriaItemSchema).min(1, { error: 'a checklist needs at least one item' })
  })
  .refine((checklist) => checklist.scope === 'global' || checklist.target !== undefined, {
    error: 'persona and doc-type checklists require a target',
    path: ['target']
  });

export type CriteriaChecklist = z.infer<typeof criteriaChecklistSchema>;
