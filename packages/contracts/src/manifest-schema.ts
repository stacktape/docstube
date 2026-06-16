import { z } from 'zod';
import { sha256Schema } from './cache-key.ts';
import { pageIdSchema, pageStatusSchema, sectionIdSchema } from './page-schema.ts';
import { packageVersionSchema, relativePathSchema } from './primitives.ts';

// `.docstube/manifest.yml` schema.
//
// The manifest is the committed, portable provenance/state record the incremental engine reads to
// decide which pages a code change affects. It captures, per page, the seed-context hash, the
// files the writer observed, and the citations it grounded on. It carries page status but no
// numeric quality score, no secrets, and no transcripts.

export const provenanceCitationSchema = z.strictObject({
  path: relativePathSchema,
  symbol: z.string().min(1).optional()
});

export type ProvenanceCitation = z.infer<typeof provenanceCitationSchema>;

export const pageProvenanceSchema = z.strictObject({
  // Hash of the seed context the page was generated from. A change here forces revisiting.
  seedHash: sha256Schema,
  reads: z.array(relativePathSchema).default([]),
  citations: z.array(provenanceCitationSchema).default([])
});

export type PageProvenance = z.infer<typeof pageProvenanceSchema>;

export const manifestPageSchema = z.strictObject({
  id: pageIdSchema,
  path: relativePathSchema,
  title: z.string().min(1).optional(),
  status: pageStatusSchema,
  sections: z.array(sectionIdSchema).default([]),
  provenance: pageProvenanceSchema
});

export type ManifestPage = z.infer<typeof manifestPageSchema>;

export const manifestSchema = z.strictObject({
  version: z.literal(1).default(1),
  generatedWith: packageVersionSchema,
  pages: z.array(manifestPageSchema).default([])
});

export type Manifest = z.infer<typeof manifestSchema>;
