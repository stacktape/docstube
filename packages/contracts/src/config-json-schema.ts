import { z } from 'zod';
import { docstubeConfigSchema } from './config-schema.ts';
import { glossarySchema } from './glossary-schema.ts';
import { iaSchema } from './ia-schema.ts';

// JSON Schemas generated from the same Zod that validates at runtime — shipped with the package
// and registered on SchemaStore for zero-setup editor autocomplete (PRODUCT §3.9.5).
export const docstubeConfigJsonSchema = (): Record<string, unknown> => ({
  $id: 'https://docstube.dev/schemas/docstube.yml.json',
  title: 'docstube.yml',
  ...z.toJSONSchema(docstubeConfigSchema, { io: 'input', unrepresentable: 'any' })
});

export const iaJsonSchema = (): Record<string, unknown> => ({
  $id: 'https://docstube.dev/schemas/ia.yml.json',
  title: 'ia.yml',
  ...z.toJSONSchema(iaSchema, { io: 'input', unrepresentable: 'any' })
});

export const glossaryJsonSchema = (): Record<string, unknown> => ({
  $id: 'https://docstube.dev/schemas/glossary.yaml.json',
  title: 'glossary.yaml',
  ...z.toJSONSchema(glossarySchema, { io: 'input', unrepresentable: 'any' })
});
