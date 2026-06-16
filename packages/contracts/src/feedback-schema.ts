import { z } from 'zod';
import { pageIdSchema, sectionIdSchema } from './page-schema.ts';
import { identifierSchema, timestampSchema } from './primitives.ts';

// Feedback record schema.
//
// The review UI captures feedback at four scopes: element, section, page, and whole-docs. The
// categorizer routes a record to a downstream target (criteria, writing instructions, glossary,
// or config). Records carry no secrets and no opaque raw judge scores.

export const feedbackScopes = ['element', 'section', 'page', 'docs'] as const;

export const feedbackScopeSchema = z.enum(feedbackScopes);

export type FeedbackScope = z.infer<typeof feedbackScopeSchema>;

// Where the categorizer routes the feedback. `uncategorized` until categorization runs.
export const feedbackCategories = ['criteria', 'instruction', 'glossary', 'config', 'uncategorized'] as const;

export const feedbackCategorySchema = z.enum(feedbackCategories);

export type FeedbackCategory = z.infer<typeof feedbackCategorySchema>;

export const feedbackStatuses = ['open', 'applied', 'dismissed'] as const;

export const feedbackStatusSchema = z.enum(feedbackStatuses);

export type FeedbackStatus = z.infer<typeof feedbackStatusSchema>;

export const feedbackRecordSchema = z
  .strictObject({
    id: identifierSchema,
    createdAt: timestampSchema,
    scope: feedbackScopeSchema,
    message: z.string().min(1, { error: 'feedback message must not be empty' }),
    pageId: pageIdSchema.optional(),
    sectionId: sectionIdSchema.optional(),
    // CSS-like selector identifying the targeted element, for element-scoped feedback.
    selector: z.string().min(1).optional(),
    category: feedbackCategorySchema.default('uncategorized'),
    status: feedbackStatusSchema.default('open')
  })
  .refine((record) => record.scope === 'docs' || record.pageId !== undefined, {
    error: 'element, section, and page feedback require a pageId',
    path: ['pageId']
  })
  .refine((record) => record.scope !== 'section' || record.sectionId !== undefined, {
    error: 'section feedback requires a sectionId',
    path: ['sectionId']
  })
  .refine((record) => record.scope !== 'element' || record.selector !== undefined, {
    error: 'element feedback requires a selector',
    path: ['selector']
  });

export type FeedbackRecord = z.infer<typeof feedbackRecordSchema>;
