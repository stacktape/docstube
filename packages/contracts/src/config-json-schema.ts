import { z } from 'zod';
import { docstubeConfigSchema } from './config-schema';
import { glossarySchema } from './glossary-schema';
import { iaSchema } from './ia-schema';

// JSON Schema generation for the config family. These power editor validation/autocomplete for
// `docstube.yml`, `ia.yml`, and `glossary.yaml`, and are snapshot-tested so the published
// contract surface cannot drift silently.

export type JsonSchema = Record<string, unknown>;

// `io: 'input'` reflects the on-disk shape: fields with defaults are optional in the file.
const toInputJsonSchema = (schema: z.ZodType): JsonSchema =>
  z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input' }) as unknown as JsonSchema;

export const docstubeConfigJsonSchema = (): JsonSchema => toInputJsonSchema(docstubeConfigSchema);

export const iaJsonSchema = (): JsonSchema => toInputJsonSchema(iaSchema);

export const glossaryJsonSchema = (): JsonSchema => toInputJsonSchema(glossarySchema);

// All config-family JSON Schemas keyed by their on-disk file name.
export const configFamilyJsonSchemas = (): Record<'docstube.yml' | 'ia.yml' | 'glossary.yaml', JsonSchema> => ({
  'docstube.yml': docstubeConfigJsonSchema(),
  'ia.yml': iaJsonSchema(),
  'glossary.yaml': glossaryJsonSchema()
});
