import { z } from 'zod';

// glossary.yaml — canonical terminology. The theme auto-links terms; the glossary verifier
// enforces consistent usage; the feedback categorizer routes terminology feedback here.
export const glossaryTermSchema = z.object({
  term: z.string().min(1),
  definition: z.string().min(1),
  aliases: z.array(z.string().min(1)).default([]),
  // Terms writers must not use (with the preferred replacement being `term`).
  avoid: z.array(z.string().min(1)).default([])
});
export type GlossaryTerm = z.infer<typeof glossaryTermSchema>;

export const glossarySchema = z.object({
  schemaVersion: z.literal(1),
  terms: z.array(glossaryTermSchema).default([])
});
export type Glossary = z.infer<typeof glossarySchema>;
