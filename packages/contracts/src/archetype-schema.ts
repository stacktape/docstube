import { z } from 'zod';
import { personaSchema } from './config-schema.ts';
import type { Persona } from './config-schema.ts';

// docType v2 (dx-knowledge-v2 decision 4): the archetype is a PRESET LAYER, not a control layer.
// It fills defaults for the explicit fields that actually drive behavior (visibility, productKind,
// coverage, suggested personas); the pipeline branches only on the explicit fields, and docType
// remains the one-word shorthand for prompts and UX. config-schema migrates in a later wave.

export const archetypeSchema = z.enum([
  'library',
  'cli-tool',
  'framework',
  'saas-product',
  'self-hosted-app',
  'api-service',
  'internal-tooling',
  'monorepo-mixed'
]);
export type Archetype = z.infer<typeof archetypeSchema>;

// Are the DOCS public — never inferred from repo privacy (most commercial repos are private with
// public docs; the wizard asks this one question explicitly).
export const visibilitySchema = z.enum(['public', 'internal']);
export type Visibility = z.infer<typeof visibilitySchema>;

export const productKindSchema = z.enum(['library', 'cli', 'service', 'application', 'mixed']);
export type ProductKind = z.infer<typeof productKindSchema>;

// Matches the existing config `coverage` field; 'auto' derives from the archetype defaults.
export const coveragePolicySchema = z.enum(['on', 'off', 'auto']);
export type CoveragePolicy = z.infer<typeof coveragePolicySchema>;

export const archetypeDefaultsSchema = z.object({
  visibility: visibilitySchema,
  productKind: productKindSchema,
  coverage: coveragePolicySchema,
  suggestedPersonas: z.array(personaSchema)
});
export type ArchetypeDefaults = z.infer<typeof archetypeDefaultsSchema>;

const persona = (id: string, description: string): Persona => ({ id, description });

const archetypeDefaults: Record<Archetype, ArchetypeDefaults> = {
  library: {
    visibility: 'public',
    productKind: 'library',
    coverage: 'on',
    suggestedPersonas: [persona('app-developer', 'Builds applications on top of the library')]
  },
  'cli-tool': {
    visibility: 'public',
    productKind: 'cli',
    coverage: 'on',
    suggestedPersonas: [persona('cli-user', 'Runs the tool from the command line and CI scripts')]
  },
  framework: {
    visibility: 'public',
    productKind: 'library',
    coverage: 'on',
    suggestedPersonas: [
      persona('app-developer', 'Builds applications inside the framework'),
      persona('plugin-author', 'Extends the framework with plugins or integrations')
    ]
  },
  'saas-product': {
    visibility: 'public',
    productKind: 'service',
    coverage: 'off',
    suggestedPersonas: [persona('end-user', 'Uses the hosted product to get their own work done')]
  },
  'self-hosted-app': {
    visibility: 'public',
    productKind: 'application',
    coverage: 'off',
    suggestedPersonas: [
      persona('operator', 'Installs, configures, and operates the application'),
      persona('end-user', 'Uses the running application')
    ]
  },
  'api-service': {
    visibility: 'public',
    productKind: 'service',
    coverage: 'on',
    suggestedPersonas: [persona('api-consumer', 'Integrates against the HTTP API')]
  },
  'internal-tooling': {
    visibility: 'internal',
    productKind: 'mixed',
    coverage: 'off',
    suggestedPersonas: [persona('team-engineer', 'Works at the company and consumes the internal tooling')]
  },
  'monorepo-mixed': {
    visibility: 'public',
    productKind: 'mixed',
    coverage: 'auto',
    suggestedPersonas: [persona('app-developer', 'Consumes one or more packages from the monorepo')]
  }
};

export const defaultsForArchetype = (archetype: Archetype): ArchetypeDefaults => archetypeDefaults[archetype];
