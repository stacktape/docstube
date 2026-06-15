import { z } from 'zod';
import { componentNameSchema } from './config-schema';
import { identifierSchema } from './primitives';

// Registry component metadata schema.
//
// The generated theme ships a registry of components the writer may use. Each entry carries the
// PascalCase component name and a reference to a Zod prop schema rather than the schema itself, so
// component metadata stays decoupled from prop-schema implementations. `Screenshot` is a reserved
// component name for the screenshot capture boundary, registered with `status: reserved`; no
// capture flow is implemented (PLAN.md hard boundary).

export const reservedComponentNames = ['Screenshot'] as const;

const reservedComponentNameSet = new Set<string>(reservedComponentNames);

export const componentStatuses = ['stable', 'experimental', 'reserved'] as const;

export const componentStatusSchema = z.enum(componentStatuses);

export type ComponentStatus = z.infer<typeof componentStatusSchema>;

// A reference to a registered Zod prop schema by stable ID.
export const propSchemaRefSchema = z.strictObject({
  ref: identifierSchema
});

export type PropSchemaRef = z.infer<typeof propSchemaRefSchema>;

export const registryComponentSchema = z
  .strictObject({
    name: componentNameSchema,
    description: z.string().min(1).optional(),
    category: z.string().min(1).optional(),
    status: componentStatusSchema.default('stable'),
    props: propSchemaRefSchema
  })
  .superRefine((component, context) => {
    const reservedName = reservedComponentNameSet.has(component.name);

    if (reservedName && component.status !== 'reserved') {
      context.addIssue({
        code: 'custom',
        message: 'reserved component names must use reserved status',
        path: ['status']
      });
    }

    if (!reservedName && component.status === 'reserved') {
      context.addIssue({
        code: 'custom',
        message: 'reserved status is limited to reserved component names',
        path: ['status']
      });
    }
  });

export type RegistryComponent = z.infer<typeof registryComponentSchema>;

export const registrySchema = z.strictObject({
  version: z.literal(1).default(1),
  components: z.array(registryComponentSchema).min(1, { error: 'a registry needs at least one component' })
});

export type ComponentRegistry = z.infer<typeof registrySchema>;
