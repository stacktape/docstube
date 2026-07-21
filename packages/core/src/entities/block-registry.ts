import type { z } from 'zod';
import type { BlockTypeRegistry, ComponentDefinition } from '@docstube/plugin-sdk';
import { componentBlockType, coreBlockTypes } from '@docstube/contracts';

// The inline <Claim id> marker (ARCHITECTURE §4.1) is claim VOCABULARY, not a component: it is
// inline-transparent to block typing (a paragraph carrying a marker stays a paragraph — see
// extract-entities.ts), so it is deliberately NOT registered here. Registering it as
// `component:Claim` would let formatting flip a block's semantic type, which broke block matching
// and structural snapshots (wave 2b-i review finding 6).

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
