import { z } from 'zod';
import type { BlockTypeRegistry, ComponentDefinition } from '@docstube/plugin-sdk';
import { claimMarkerIdSchema, componentBlockType, coreBlockTypes } from '@docstube/contracts';

// The inline claim marker (ARCHITECTURE §4.1) is core MDX vocabulary, not a theme component:
// every generated page may carry <Claim id="…">…</Claim>, so the registry always knows it —
// entity-integrity validates the id prop instead of capping the block as unknown.
const claimMarkerProps = z.object({ id: claimMarkerIdSchema });

// The block-type registry realizes the open enum (PRODUCT §3.1): core primitives plus one
// `component:<Name>` type per registered component. Assembled at plugin-load time.
export const createBlockRegistry = (components: ComponentDefinition[]): BlockTypeRegistry => {
  const byType = new Map<string, { propsSchema: z.ZodType }>();
  byType.set(componentBlockType('Claim'), { propsSchema: claimMarkerProps });
  for (const component of components) {
    byType.set(componentBlockType(component.name), { propsSchema: component.propsSchema });
  }
  return {
    get: (blockType) => byType.get(blockType),
    list: () => [...coreBlockTypes, ...byType.keys()]
  };
};
