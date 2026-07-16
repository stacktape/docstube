import { z } from 'zod';
import {
  blockIdSchema,
  claimIdSchema,
  localeCodeSchema,
  pageIdSchema,
  sectionIdSchema,
  sha256HexSchema,
  versionLabelSchema
} from './primitives.ts';
import { guaranteeLevelSchema, provenanceSchema } from './provenance-schema.ts';

// Block types are an open enum (PRODUCT §3.1): core primitives below, plus one type per
// registered theme/plugin component ("component:Callout"). Never a closed union.
export const coreBlockTypes = [
  'paragraph',
  'heading',
  'list',
  'table',
  'code-example',
  'blockquote',
  'image',
  'thematic-break',
  'raw'
] as const;
export type CoreBlockType = (typeof coreBlockTypes)[number];

export const blockTypeSchema = z
  .string()
  .regex(/^(component:[A-Z][A-Za-z0-9]*|[a-z][a-z0-9-]*)$/, 'expected a core block type or "component:<Name>"');
export type BlockType = z.infer<typeof blockTypeSchema>;

export const componentBlockType = (componentName: string): string => `component:${componentName}`;

// Claims anchor to text by quote + context (web-annotation style), never by character offsets —
// robust to whitespace and surrounding edits.
export const claimAnchorSchema = z.object({
  quote: z.string().min(1),
  prefix: z.string().default(''),
  suffix: z.string().default('')
});
export type ClaimAnchor = z.infer<typeof claimAnchorSchema>;

// Claim classes come from the private failure-mode taxonomy (PRODUCT §3.8) and are extensible.
export const claimClassSchema = z.string().regex(/^[a-z][a-z0-9-]*$/);
export const knownClaimClasses = [
  'factual',
  'api-shape',
  'behavioral',
  'code-sample',
  'structural',
  'configuration',
  'tribal'
] as const;

export const claimEntitySchema = z.object({
  id: claimIdSchema,
  kind: z.literal('claim'),
  text: z.string().min(1),
  anchor: claimAnchorSchema,
  claimClass: claimClassSchema,
  guarantee: guaranteeLevelSchema,
  // Absent means: inherits the enclosing block's provenance.
  provenance: provenanceSchema.optional()
});
export type ClaimEntity = z.infer<typeof claimEntitySchema>;

export const codeVariantSchema = z.object({
  language: z.string().min(1),
  contentHash: sha256HexSchema
});

export const blockEntitySchema = z.object({
  id: blockIdSchema,
  kind: z.literal('block'),
  blockType: blockTypeSchema,
  // Validated against the block-type registry (per-type Zod schema) at extraction time; stored
  // as-is so shards remain readable without the registry.
  metadata: z.unknown().optional(),
  contentHash: sha256HexSchema,
  // For code-example blocks: canonical language now, verified per-language variants in v2.
  language: z.string().optional(),
  variants: z.array(codeVariantSchema).default([]),
  claims: z.array(claimEntitySchema).default([]),
  guarantee: guaranteeLevelSchema,
  provenance: provenanceSchema
});
export type BlockEntity = z.infer<typeof blockEntitySchema>;

// Sections are stored flat with a heading level; the tree is derived. Flat storage keeps shards
// diff-friendly and the matching pass simple.
export const sectionEntitySchema = z.object({
  id: sectionIdSchema,
  kind: z.literal('section'),
  title: z.string().min(1),
  level: z.number().int().min(1).max(6),
  anchor: z.string().min(1),
  blocks: z.array(blockEntitySchema).default([]),
  guarantee: guaranteeLevelSchema
});
export type SectionEntity = z.infer<typeof sectionEntitySchema>;

export const pageEntitySchema = z.object({
  id: pageIdSchema,
  kind: z.literal('page'),
  // Slug and title are mutable attributes; the id is the identity.
  slug: z.string().regex(/^[a-z0-9]+(?:[/-][a-z0-9]+)*$/),
  title: z.string().min(1),
  description: z.string().optional(),
  // Blocks before the first heading.
  preamble: z.array(blockEntitySchema).default([]),
  sections: z.array(sectionEntitySchema).default([]),
  guarantee: guaranteeLevelSchema,
  provenance: provenanceSchema
});
export type PageEntity = z.infer<typeof pageEntitySchema>;

// Version and locale are address dimensions, not id mutations (ARCHITECTURE.md §3.3).
export const entityAddressSchema = z.object({
  version: versionLabelSchema,
  locale: localeCodeSchema,
  pageId: pageIdSchema,
  // Absent means the address points at the page itself.
  entityId: z.union([sectionIdSchema, blockIdSchema, claimIdSchema]).optional()
});
export type EntityAddress = z.infer<typeof entityAddressSchema>;

export const listPageEntityIds = (page: PageEntity): string[] => {
  const ids: string[] = [page.id];
  const collectBlock = (block: BlockEntity) => {
    ids.push(block.id);
    for (const claim of block.claims) {
      ids.push(claim.id);
    }
  };
  for (const block of page.preamble) {
    collectBlock(block);
  }
  for (const section of page.sections) {
    ids.push(section.id);
    for (const block of section.blocks) {
      collectBlock(block);
    }
  }
  return ids;
};
