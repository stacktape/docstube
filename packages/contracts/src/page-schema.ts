import { z } from 'zod';
import { layoutSchema } from './config-schema.ts';
import { identifierSchema, semverSchema, timestampSchema } from './primitives.ts';
import { extractSectionMarkers } from './section-markers.ts';

// Page and section ID rules, the generated-page frontmatter schema, and the uniqueness/presence
// checks downstream packages reuse. A page ID is one or more lowercase kebab-case segments joined
// by `/`, allowing hierarchical IDs such as `guides/install`. A section ID is a single kebab-case
// segment, matching the section marker convention in `section-markers.ts`.

const kebabSegment = '[a-z0-9]+(?:-[a-z0-9]+)*';

const pageIdPattern = new RegExp(`^${kebabSegment}(?:/${kebabSegment})*$`);

export const pageIdSchema = z
  .string()
  .min(1, { error: 'page id must not be empty' })
  .max(256, { error: 'page id must be at most 256 characters' })
  .regex(pageIdPattern, { error: 'page id must be lowercase kebab-case segments joined by `/`' });

export type PageId = z.infer<typeof pageIdSchema>;

export const sectionIdSchema = z
  .string()
  .min(1, { error: 'section id must not be empty' })
  .max(128, { error: 'section id must be at most 128 characters' })
  .regex(new RegExp(`^${kebabSegment}$`), { error: 'section id must be a single lowercase kebab-case segment' });

export type SectionId = z.infer<typeof sectionIdSchema>;

// Page lifecycle state. Quality scoring is derived separately from criteria and findings; status
// remains the coarse gate outcome.
export const pageStatuses = ['passed', 'flagged'] as const;

export const pageStatusSchema = z.enum(pageStatuses);

export type PageStatus = z.infer<typeof pageStatusSchema>;

// Provenance stamp embedded in generated-page frontmatter. Marks a file as docstube-owned and
// records the producing version and time, without carrying pipeline state or findings.
export const generatedStampSchema = z.strictObject({
  by: z.literal('docstube'),
  version: semverSchema,
  at: timestampSchema
});

export type GeneratedStamp = z.infer<typeof generatedStampSchema>;

export const generatedPageFrontmatterSchema = z.strictObject({
  id: pageIdSchema,
  title: z.string().min(1, { error: 'page title must not be empty' }),
  description: z.string().optional(),
  layout: layoutSchema.optional(),
  personas: z.array(identifierSchema).optional(),
  // Ordered section IDs declared by the page; must match the body's section markers.
  sections: z.array(sectionIdSchema).optional(),
  generated: generatedStampSchema
});

export type GeneratedPageFrontmatter = z.infer<typeof generatedPageFrontmatterSchema>;

// Return the IDs that appear more than once, in first-seen order. Empty when all IDs are unique.
const duplicates = (ids: readonly string[]): string[] => {
  const seen = new Set<string>();
  const repeated = new Set<string>();

  for (const id of ids) {
    if (seen.has(id)) {
      repeated.add(id);
    } else {
      seen.add(id);
    }
  }

  return [...repeated];
};

// Page-level uniqueness across a page set (e.g. the manifest's pages).
export const duplicatePageIds = (pageIds: readonly string[]): string[] => duplicates(pageIds);

// Section-level uniqueness within a single page.
export const duplicateSectionIds = (sectionIds: readonly string[]): string[] => duplicates(sectionIds);

export type SectionPresenceResult = {
  // Declared in frontmatter but missing a balanced start/end marker pair in the body.
  missing: string[];
  // Present in the body markers but not declared in frontmatter.
  undeclared: string[];
  // Section IDs whose start/end markers are unbalanced in the body.
  unbalanced: string[];
};

// Check that frontmatter-declared sections and the body's section markers agree: every declared
// section has a balanced marker pair, no marker is undeclared, and no marker pair is unbalanced.
export const checkSectionPresence = (declared: readonly string[], body: string): SectionPresenceResult => {
  const markers = extractSectionMarkers(body);

  const states = new Map<
    string,
    { starts: number; ends: number; open: boolean; orderedPair: boolean; invalidOrder: boolean }
  >();

  const stateFor = (id: string) => {
    const existing = states.get(id);
    if (existing) {
      return existing;
    }

    const state = { starts: 0, ends: 0, open: false, orderedPair: false, invalidOrder: false };
    states.set(id, state);
    return state;
  };

  for (const marker of markers) {
    const state = stateFor(marker.sectionId);

    if (marker.kind === 'start') {
      state.starts += 1;
      if (state.open) {
        state.invalidOrder = true;
      }
      state.open = true;
      continue;
    }

    state.ends += 1;
    if (!state.open) {
      state.invalidOrder = true;
      continue;
    }

    state.orderedPair = true;
    state.open = false;
  }

  const markerIds = new Set(states.keys());
  const declaredSet = new Set(declared);

  const balanced = new Set<string>();
  const unbalanced: string[] = [];
  for (const id of markerIds) {
    const state = states.get(id)!;
    if (state.starts === 1 && state.ends === 1 && state.orderedPair && !state.invalidOrder && !state.open) {
      balanced.add(id);
    } else {
      unbalanced.push(id);
    }
  }

  const missing = declared.filter((id) => !balanced.has(id));
  const undeclared = [...balanced].filter((id) => !declaredSet.has(id));

  return { missing, undeclared, unbalanced };
};
