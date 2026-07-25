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
import { provenanceSchema } from './provenance-schema.ts';

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

// The legacy per-entity ClaimEntity/guarantee vocabulary is GONE from the live entity model
// (wave 2b demolition): trust state lives on the claim LEDGER + ClaimEvidence (claim-ledger and
// provenance-v2 schemas); reader surfaces project literal claim counts. `docstube audit` keeps
// its own local claim-extraction shapes (core/src/audit/extract-claims.ts) for foreign docs.

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
  provenance: provenanceSchema
});
export type BlockEntity = z.infer<typeof blockEntitySchema>;

// UNRENDERABLE SECTION ANCHORS (wave 2b close, impl-23 finding 3): Astro's rehypeHeadingIds slugs
// every heading with github-slugger, and a heading whose text slugs to the empty string (pure
// punctuation or emoji, e.g. "## .") renders as `id=""` — nothing can ever resolve it with
// getElementById. The manifest schema requires a non-empty anchor, so such a section gets a
// SYNTHETIC anchor carrying this prefix. The '#' can never appear in a github slug, so the value
// cannot collide with a real anchor, and every reader surface omits its chip instead of attaching
// it to whatever heading happens to answer the id.
export const unrenderableAnchorPrefix = '#unrenderable-';

export const isRenderableAnchor = (anchor: string): boolean => !anchor.startsWith(unrenderableAnchorPrefix);

// Sections are stored flat with a heading level; the tree is derived. Flat storage keeps shards
// diff-friendly and the matching pass simple.
export const sectionEntitySchema = z.object({
  id: sectionIdSchema,
  kind: z.literal('section'),
  title: z.string().min(1),
  level: z.number().int().min(1).max(6),
  anchor: z.string().min(1),
  blocks: z.array(blockEntitySchema).default([])
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
  for (const block of page.preamble) {
    ids.push(block.id);
  }
  for (const section of page.sections) {
    ids.push(section.id);
    for (const block of section.blocks) {
      ids.push(block.id);
    }
  }
  return ids;
};
