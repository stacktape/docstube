import { z } from 'zod';
import { identifierSchema, relativePathSchema } from './primitives';

// Config family schema for `ia.yml`: the committed information architecture.
//
// The IA is an ordered nav tree. Each node has a stable page ID, a human title, and an
// optional brief that seeds the writer. Branch nodes hold children; leaf nodes map to a page.
// The local UI edits this tree through the shared NavTree component.

export type IaNode = {
  id: string;
  title: string;
  brief?: string;
  path?: string;
  children?: IaNode[];
};

export const iaNodeSchema: z.ZodType<IaNode> = z.lazy(() =>
  z.strictObject({
    id: identifierSchema,
    title: z.string().min(1, { error: 'nav node title must not be empty' }),
    brief: z.string().optional(),
    // Output-relative slug/path for a leaf page, when this node renders a page.
    path: relativePathSchema.optional(),
    children: z.array(iaNodeSchema).optional()
  })
);

export const iaSchema = z.strictObject({
  version: z.literal(1).default(1),
  layout: z.enum(['single-tree', 'sectioned']).optional(),
  nav: z.array(iaNodeSchema).min(1, { error: 'ia must declare at least one nav node' })
});

export type Ia = z.infer<typeof iaSchema>;
