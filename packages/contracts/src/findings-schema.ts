import { z } from 'zod';
import { pageIdSchema, sectionIdSchema } from './page-schema.ts';
import { identifierSchema, jsonValueSchema, relativePathSchema, severitySchema } from './primitives.ts';

// Findings schema.
//
// Every issue raised by a verifier or reviewer is a structured finding. Quality scores are derived
// separately from findings and criteria, never stored as opaque raw judge numbers. Severity uses
// the fixed blocker/major/minor taxonomy.

// Where a finding originated. Deterministic verifiers and persona reviewers both emit findings.
export const findingOrigins = ['verifier', 'reviewer', 'writer', 'editor'] as const;

export const findingOriginSchema = z.enum(findingOrigins);

export type FindingOrigin = z.infer<typeof findingOriginSchema>;

// Optional source location for a finding, repo-relative.
export const findingLocationSchema = z.strictObject({
  path: relativePathSchema.optional(),
  line: z.int().positive().optional(),
  column: z.int().positive().optional()
});

export type FindingLocation = z.infer<typeof findingLocationSchema>;

export const findingSchema = z.strictObject({
  // Stable machine code for the rule that produced the finding (e.g. `mdx-compile`).
  code: identifierSchema,
  severity: severitySchema,
  origin: findingOriginSchema,
  message: z.string().min(1, { error: 'finding message must not be empty' }),
  pageId: pageIdSchema.optional(),
  sectionId: sectionIdSchema.optional(),
  location: findingLocationSchema.optional(),
  // Opaque structured payload for renderers and the retry loop. Never carries secrets.
  meta: jsonValueSchema.optional()
});

export type Finding = z.infer<typeof findingSchema>;
