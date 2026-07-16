import type { z } from 'zod';
import type { BlockTypeRegistry, ComponentDefinition } from '@docstube/plugin-sdk';
import { componentBlockType, coreBlockTypes } from '@docstube/contracts';

// The block-type registry realizes the open enum (PRODUCT §3.1): core primitives plus one
// `component:<Name>` type per registered component. Assembled at plugin-load time.
export const createBlockRegistry = (components: ComponentDefinition[]): BlockTypeRegistry => {
  const byType = new Map<string, { propsSchema: z.ZodType }>();
  for (const component of components) {
    byType.set(componentBlockType(component.name), { propsSchema: component.propsSchema });
  }
  return {
    get: (blockType) => byType.get(blockType),
    list: () => [...coreBlockTypes, ...byType.keys()]
  };
};
