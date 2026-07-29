import { describe, expect, it } from 'vitest';
import { declaredSchemaShapeSchema, resolveSchemaField, serializeSchemaShape } from './schema-shape-schema.ts';

const shape = declaredSchemaShapeSchema.parse({
  kind: 'object',
  fields: {
    docType: { optional: false },
    outDir: { optional: true, defaultValue: '"docs-site"' },
    plugins: { optional: true, defaultUnknown: true },
    'budgets.maxRunUsd': { optional: true, defaultValue: '20' },
    'limits.maxRunUsd': { optional: true, defaultValue: '10' },
    'agents.transport': { optional: true, defaultValue: '"claude-cli"' }
  }
});

describe('resolveSchemaField', () => {
  it('resolves an exact path, and a UNIQUE leaf name the docs spelled bare', () => {
    expect(resolveSchemaField(shape, 'docType')?.path).toBe('docType');
    expect(resolveSchemaField(shape, 'agents.transport')?.path).toBe('agents.transport');
    // Docs say "defaults `transport` to claude-cli"; only one field has that leaf.
    expect(resolveSchemaField(shape, 'transport')?.path).toBe('agents.transport');
  });

  it('never guesses: an ambiguous leaf and an absent field both fail to resolve', () => {
    // Two nestings share the leaf 'maxRunUsd' — the sentence could mean either.
    expect(resolveSchemaField(shape, 'maxRunUsd')).toBeUndefined();
    expect(resolveSchemaField(shape, 'nope')).toBeUndefined();
  });
});

describe('serializeSchemaShape', () => {
  it('is stable under field reordering and moves on every recorded fact', () => {
    const reordered = declaredSchemaShapeSchema.parse({
      kind: 'object',
      fields: Object.fromEntries(Object.entries(shape.fields).toReversed())
    });
    expect(serializeSchemaShape(reordered)).toBe(serializeSchemaShape(shape));
    const renamed = declaredSchemaShapeSchema.parse({ kind: 'object', fields: { docType: { optional: true } } });
    const original = declaredSchemaShapeSchema.parse({ kind: 'object', fields: { docType: { optional: false } } });
    expect(serializeSchemaShape(renamed)).not.toBe(serializeSchemaShape(original));
    // 'no default' and 'a default we cannot read' must never serialize identically.
    expect(
      serializeSchemaShape(
        declaredSchemaShapeSchema.parse({ kind: 'object', fields: { a: { optional: true, defaultUnknown: true } } })
      )
    ).not.toBe(
      serializeSchemaShape(declaredSchemaShapeSchema.parse({ kind: 'object', fields: { a: { optional: true } } }))
    );
  });
});
