import { describe, expect, it } from 'vitest';
import { extractSchemaShapes } from './schema-shape.ts';

const shapes = (content: string) => extractSchemaShapes({ file: 'src/config.ts', content });

describe('extractSchemaShapes', () => {
  it('reads fields, optionality, and literal defaults from an object schema', () => {
    const result = shapes(
      "import { z } from 'zod';\n" +
        'export const configSchema = z.strictObject({\n' +
        '  schemaVersion: z.literal(1),\n' +
        '  docType: docTypeSchema,\n' +
        "  outDir: repoPathSchema.default('docs-site'),\n" +
        '  retries: z.number().positive().default(3).describe("how many"),\n' +
        '  note: z.string().optional(),\n' +
        '  plugins: z.array(z.string()).default([])\n' +
        '});\n'
    );
    expect(result.configSchema).toEqual({
      kind: 'object',
      fields: {
        schemaVersion: { optional: false, defaultUnknown: false },
        docType: { optional: false, defaultUnknown: false },
        outDir: { optional: true, defaultValue: '"docs-site"', defaultUnknown: false },
        retries: { optional: true, defaultValue: '3', defaultUnknown: false },
        note: { optional: true, defaultUnknown: false },
        // `.default([])` IS a default, but not one the parser may read as a literal.
        plugins: { optional: true, defaultUnknown: true }
      }
    });
  });

  it('extends the dot path through INLINE nested object schemas', () => {
    const result = shapes(
      'export const agentsSchema = z.strictObject({\n' +
        '  budgets: z.strictObject({ maxRunUsd: z.number().default(20) }).prefault({}),\n' +
        '  nested: otherSchema\n' +
        '});\n'
    );
    expect(Object.keys(result.agentsSchema?.fields ?? {})).toEqual(['budgets', 'budgets.maxRunUsd', 'nested']);
    expect(result.agentsSchema?.fields['budgets.maxRunUsd']).toEqual({
      optional: true,
      defaultValue: '20',
      defaultUnknown: false
    });
  });

  it('reads enum members as fields, quoted hyphenated members included', () => {
    const result = shapes("export const transportIdSchema = z.enum(['claude-cli', 'codex-cli']);\n");
    expect(result.transportIdSchema).toEqual({
      kind: 'enum',
      fields: {
        'claude-cli': { optional: false, defaultUnknown: false },
        'codex-cli': { optional: false, defaultUnknown: false }
      }
    });
  });

  it('keeps shape-preserving chains and REFUSES anything that redefines the field set', () => {
    const kept = shapes(
      'export const a = z.strictObject({ x: z.string() }).superRefine(() => {}).describe("d");\n' +
        'export const b = z.object({ y: z.string() }).optional();\n'
    );
    expect(Object.keys(kept.a?.fields ?? {})).toEqual(['x']);
    expect(Object.keys(kept.b?.fields ?? {})).toEqual(['y']);
    const refused = shapes(
      'export const c = base.extend({ x: z.string() });\n' +
        'export const d = z.object({ x: z.string() }).partial();\n' +
        'export const e = z.object({ x: z.string() }).pick({ x: true });\n' +
        'export const f = z.object(buildFields());\n' +
        'export const g = z.object({ ...base, x: z.string() });\n'
    );
    expect(refused.c).toBeUndefined();
    expect(refused.d).toBeUndefined();
    expect(refused.e).toBeUndefined();
    expect(refused.f).toBeUndefined();
    // A spread does not refuse the record — it contributes no readable field, and an absent field
    // is never contradicted, only unresolvable.
    expect(Object.keys(refused.g?.fields ?? {})).toEqual(['x']);
  });

  it('extracts nothing for non-schema declarations and non-exported ones', () => {
    expect(shapes('export const notASchema = { a: 1 };\n')).toEqual({});
    expect(shapes('const hidden = z.object({ a: z.string() });\n')).toEqual({});
  });
});
