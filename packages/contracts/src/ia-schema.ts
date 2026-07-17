import { z } from 'zod';
import { pageIdSchema } from './primitives.ts';

// ia.yml — the information architecture tree with page briefs. Edited by the wizard NavTree or by
// hand/agents; same comment-preserving round-trip rule as docstube.yml.

// Depth budget per node (PRODUCT §7.2 sketch): the IA-proposal task must respect it and the
// review stage checks conformance.
export const depthBudgetSchema = z.enum(['overview', 'standard', 'deep']);

export type IaNode = {
  title: string;
  slug: string;
  // Seeds the writer for this page (PRODUCT §3.9.2 step 5). Nodes without a brief are pure
  // grouping nodes and render no page of their own.
  brief?: string | undefined;
  depth?: z.infer<typeof depthBudgetSchema> | undefined;
  // Assigned by the kernel once the page exists; absent for not-yet-generated nodes.
  pageId?: string | undefined;
  children?: IaNode[] | undefined;
};

// Strict: ia.yml is human-edited, so a typo'd key (`breif`) must be a hard error, not a silently
// dropped field that quietly turns a page into a grouping node.
export const iaNodeSchema: z.ZodType<IaNode> = z.strictObject({
  title: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  brief: z.string().optional(),
  depth: depthBudgetSchema.optional(),
  pageId: pageIdSchema.optional(),
  children: z.array(z.lazy(() => iaNodeSchema)).optional()
});

export const iaSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    // With the `sectioned` site layout, top-level nodes render as section tabs.
    tree: z.array(iaNodeSchema).min(1),
    // Global page-count target the depth policy works against (PRODUCT §7.2).
    pageCountTarget: z.number().int().positive().optional()
  })
  .superRefine((ia, ctx) => {
    // ia.yml is hand-edited: copy-pasted nodes must fail here, not silently collide the manifest
    // shard (pageId) or the emitted route (pages write content/<locale>/<slug>.mdx by bare slug).
    const seenPageIds = new Set<string>();
    const seenPageSlugs = new Set<string>();
    for (const node of walkIaNodes(ia.tree)) {
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
      if (node.brief !== undefined || node.pageId !== undefined) {
        if (seenPageSlugs.has(node.slug)) {
          ctx.addIssue({
            code: 'custom',
            path: ['tree'],
            message: `duplicate page slug "${node.slug}" — two pages would collide on the same route`
          });
        }
        seenPageSlugs.add(node.slug);
      }
    }
  });
export type Ia = z.infer<typeof iaSchema>;

export const walkIaNodes = (tree: readonly IaNode[]): IaNode[] => {
  const nodes: IaNode[] = [];
  const visit = (node: IaNode) => {
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
