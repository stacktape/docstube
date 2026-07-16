import { describe, expect, it } from 'vitest';
import { checkJsonSchema } from './json-schema-check.ts';

describe('checkJsonSchema', () => {
  it('accepts a conforming object', () => {
    const schema = {
      type: 'object',
      required: ['title', 'severity'],
      properties: {
        title: { type: 'string' },
        severity: { type: 'string', enum: ['info', 'warning', 'error'] },
        line: { type: 'integer' }
      }
    };
    expect(checkJsonSchema({ title: 'stale default', severity: 'warning', line: 12 }, schema)).toEqual([]);
  });

  it('reports type mismatches with a path', () => {
    const issues = checkJsonSchema('not an object', { type: 'object' });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ path: '$' });
    expect(issues[0]?.message).toContain('expected type object');
  });

  it('distinguishes integer from number', () => {
    expect(checkJsonSchema(1.5, { type: 'integer' })).toHaveLength(1);
    expect(checkJsonSchema(1.5, { type: 'number' })).toEqual([]);
  });

  it('reports missing required properties', () => {
    const issues = checkJsonSchema({}, { type: 'object', required: ['title'] });
    expect(issues[0]?.message).toContain('missing required property "title"');
  });

  it('recurses into nested properties and array items', () => {
    const schema = {
      type: 'object',
      properties: {
        findings: {
          type: 'array',
          items: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } }
        }
      }
    };
    const issues = checkJsonSchema({ findings: [{ id: 'ok' }, { id: 42 }, {}] }, schema);
    expect(issues.map((issue) => issue.path)).toEqual(['$.findings[1].id', '$.findings[2]']);
  });

  it('enforces enum membership with deep equality', () => {
    expect(checkJsonSchema('warning', { enum: ['info', 'warning'] })).toEqual([]);
    expect(checkJsonSchema('fatal', { enum: ['info', 'warning'] })).toHaveLength(1);
  });
});
