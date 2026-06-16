import { z } from 'zod';
import { identifierSchema } from './primitives.ts';

// Config family schema for `glossary.yaml`: committed glossary terms and aliases.
//
// Terms feed build-time glossary autolinking and the glossary verifier. Each term has a stable
// ID, a display term, a definition, and optional aliases that also resolve to the same entry.

export const glossaryTermSchema = z.strictObject({
  id: identifierSchema,
  term: z.string().min(1, { error: 'glossary term must not be empty' }),
  definition: z.string().min(1, { error: 'glossary definition must not be empty' }),
  aliases: z.array(z.string().min(1)).optional()
});

export type GlossaryTerm = z.infer<typeof glossaryTermSchema>;

export const glossarySchema = z.strictObject({
  version: z.literal(1).default(1),
  terms: z.array(glossaryTermSchema)
});

export type Glossary = z.infer<typeof glossarySchema>;
