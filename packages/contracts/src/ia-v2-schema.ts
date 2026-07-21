import { z } from 'zod';
import { depthBudgetSchema } from './ia-schema.ts';
import type { Ia, IaNode } from './ia-schema.ts';
import { pageIdSchema } from './primitives.ts';

// ia.yml v2 (quality-ci-reader-v2 decision 19): an explicit discriminated union of group and page
// nodes replaces the "node without a brief is a group" inference. Groups own stable groupIds (the
// scope key for structural findings) and optional consistency rules; pages own the primary
// persona (release-scope-v2 decision 2) and a source scope feeding the coverage-obligation
// ratchet. ia.yml holds only user intent — AI-derived structure profiles are derived state and
// never live here.

// 'off' → no consistency checking for the group; 'inferred' → sibling-convention candidates may be
// detected (AI-adjudicated, candidate-only); 'explicit' → the listed rules are deterministic.
export const consistencyModeSchema = z.enum(['off', 'inferred', 'explicit']);

// Consistency rules are registry-addressed { code, parameters } records: the rule registry owns
// each code's parameter schema, so new deterministic rules never require an ia.yml schema break.
export const consistencyRuleCodeSchema = z.string().regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/);

// Built-in rule codes shipped in 0.1.0. 'required-facets' takes { facets: string[] } — the former
// dedicated requiredFacets field is this one rule.
export const builtinConsistencyRuleCodes = ['required-facets'] as const;

export const consistencyRuleSchema = z.strictObject({
  code: consistencyRuleCodeSchema,
  parameters: z.record(z.string().min(1), z.unknown()).optional()
});
export type ConsistencyRule = z.infer<typeof consistencyRuleSchema>;

// Which source files/symbols a page owns, aligned with coverage obligations (ARCHITECTURE §13.1,
// quality-ci-reader-v2 decision 13): new symbols matching a page's scope route to it as the
// candidate page instead of landing unassigned.
export type IaPageSourceScope = {
  globs?: string[] | undefined;
  // Human-readable symbol path patterns (container paths), not hashes — ia.yml is hand-edited.
  symbols?: string[] | undefined;
};

export type IaGroupConsistency = {
  mode: z.infer<typeof consistencyModeSchema>;
  rules?: ConsistencyRule[] | undefined;
};

export type IaGroupNodeV2 = {
  kind: 'group';
  groupId: string;
  title: string;
  consistency?: IaGroupConsistency | undefined;
  children: IaNodeV2[];
};

export type IaPageNodeV2 = {
  kind: 'page';
  // Assigned by the kernel once the page exists; absent for not-yet-generated nodes.
  pageId?: string | undefined;
  slug: string;
  title: string;
  brief: string;
  primaryPersona: string;
  secondaryPersonas?: string[] | undefined;
  sourceScope?: IaPageSourceScope | undefined;
  structureProfile?: string | undefined;
  // Facet/rule codes this page is exempt from (e.g. a sibling legitimately missing a section).
  structuralExceptions?: string[] | undefined;
  depth: z.infer<typeof depthBudgetSchema>;
  children?: IaNodeV2[] | undefined;
};

export type IaNodeV2 = IaGroupNodeV2 | IaPageNodeV2;

const personaIdSchema = z.string().regex(/^[a-z][a-z0-9-]*$/);
const slugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const sourceScopeObjectSchema = z.strictObject({
  globs: z.array(z.string().min(1)).optional(),
  symbols: z.array(z.string().min(1)).optional()
});

// Strict: ia.yml is human-edited, so a typo'd key must be a hard error.
const iaGroupNodeV2ObjectSchema = z.strictObject({
  kind: z.literal('group'),
  groupId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  title: z.string().min(1),
  consistency: z
    .strictObject({ mode: consistencyModeSchema, rules: z.array(consistencyRuleSchema).optional() })
    .optional(),
  children: z.array(z.lazy((): z.ZodType<IaNodeV2> => iaNodeV2Schema))
});

const iaPageNodeV2ObjectSchema = z.strictObject({
  kind: z.literal('page'),
  pageId: pageIdSchema.optional(),
  slug: slugSchema,
  title: z.string().min(1),
  brief: z.string().min(1),
  primaryPersona: personaIdSchema,
  secondaryPersonas: z.array(personaIdSchema).optional(),
  sourceScope: sourceScopeObjectSchema.optional(),
  structureProfile: z.string().min(1).optional(),
  structuralExceptions: z.array(z.string().min(1)).optional(),
  depth: depthBudgetSchema,
  children: z.array(z.lazy((): z.ZodType<IaNodeV2> => iaNodeV2Schema)).optional()
});

export const iaNodeV2Schema: z.ZodType<IaNodeV2> = z.lazy(() =>
  z.discriminatedUnion('kind', [iaGroupNodeV2ObjectSchema, iaPageNodeV2ObjectSchema])
);

export const walkIaV2Nodes = (tree: readonly IaNodeV2[]): IaNodeV2[] => {
  const nodes: IaNodeV2[] = [];
  const visit = (node: IaNodeV2) => {
    nodes.push(node);
    for (const child of node.children ?? []) {
      visit(child);
    }
  };
  for (const node of tree) {
    visit(node);
  }
  return nodes;
};

export const iaV2Schema = z
  .strictObject({
    schemaVersion: z.literal(2),
    tree: z.array(iaNodeV2Schema).min(1),
    pageCountTarget: z.number().int().positive().optional()
  })
  .superRefine((ia, ctx) => {
    const seenPageIds = new Set<string>();
    const seenSlugs = new Set<string>();
    const seenGroupIds = new Set<string>();
    for (const node of walkIaV2Nodes(ia.tree)) {
      if (node.kind === 'group') {
        if (seenGroupIds.has(node.groupId)) {
          ctx.addIssue({
            code: 'custom',
            path: ['tree'],
            message: `duplicate groupId "${node.groupId}" — group identity must be stable and unique`
          });
        }
        seenGroupIds.add(node.groupId);
        continue;
      }
      if (node.pageId !== undefined) {
        if (seenPageIds.has(node.pageId)) {
          ctx.addIssue({
            code: 'custom',
            path: ['tree'],
            message: `duplicate pageId "${node.pageId}" — every IA node must own a distinct page`
          });
        }
        seenPageIds.add(node.pageId);
      }
      if (seenSlugs.has(node.slug)) {
        ctx.addIssue({
          code: 'custom',
          path: ['tree'],
          message: `duplicate page slug "${node.slug}" — two pages would collide on the same route`
        });
      }
      seenSlugs.add(node.slug);
    }
  });
export type IaV2 = z.infer<typeof iaV2Schema>;

// Pure upgrade from the legacy ia.yml shape: nodes with a brief or a pageId become page nodes
// (brief falls back to the title; depth defaults to 'standard'; the primary persona comes from the
// caller — the wizard/migration wave infers real per-page personas later). Grouping nodes become
// group nodes with a groupId derived from the ancestor slug path.
export const convertIaToV2 = (ia: Ia, options: { defaultPrimaryPersona: string }): IaV2 => {
  const convertNode = (node: IaNode, ancestrySlugs: readonly string[]): IaNodeV2 => {
    const rendersPage = node.brief !== undefined || node.pageId !== undefined;
    const childAncestry = [...ancestrySlugs, node.slug];
    const children = node.children?.map((child) => convertNode(child, childAncestry));
    if (rendersPage) {
      return {
        kind: 'page',
        ...(node.pageId !== undefined ? { pageId: node.pageId } : {}),
        slug: node.slug,
        title: node.title,
        brief: node.brief ?? node.title,
        primaryPersona: options.defaultPrimaryPersona,
        depth: node.depth ?? 'standard',
        ...(children !== undefined ? { children } : {})
      };
    }
    return {
      kind: 'group',
      groupId: childAncestry.join('-'),
      title: node.title,
      children: children ?? []
    };
  };
  return iaV2Schema.parse({
    schemaVersion: 2,
    tree: ia.tree.map((node) => convertNode(node, [])),
    ...(ia.pageCountTarget !== undefined ? { pageCountTarget: ia.pageCountTarget } : {})
  });
};
