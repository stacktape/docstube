import { canonicalJson } from '@docstube/contracts';

// Minimal structural JSON Schema validator for structured task outputs. Zod cannot validate an
// arbitrary serialized JSON schema, and pulling in a full validator is overkill for the repair
// loop: type / required / properties / items / enum cover what task schemas actually use.

export type JsonSchemaIssue = { path: string; message: string };

const typeMatches = (value: unknown, type: string): boolean => {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    case 'array':
      return Array.isArray(value);
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    default:
      return true;
  }
};

const isSchemaObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const checkJsonSchema = (value: unknown, schema: Record<string, unknown>, path = '$'): JsonSchemaIssue[] => {
  const issues: JsonSchemaIssue[] = [];

  const declaredTypes =
    typeof schema.type === 'string'
      ? [schema.type]
      : Array.isArray(schema.type)
        ? schema.type.filter((entry): entry is string => typeof entry === 'string')
        : undefined;
  if (declaredTypes && declaredTypes.length > 0 && !declaredTypes.some((type) => typeMatches(value, type))) {
    issues.push({
      path,
      message: `expected type ${declaredTypes.join(' | ')}, got ${Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value}`
    });
    return issues;
  }

  if (
    Array.isArray(schema.enum) &&
    !schema.enum.some((candidate) => canonicalJson(candidate) === canonicalJson(value))
  ) {
    issues.push({
      path,
      message: `expected one of ${schema.enum.map((candidate) => JSON.stringify(candidate)).join(', ')}`
    });
  }

  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (typeof key === 'string' && !(key in record)) {
          issues.push({ path, message: `missing required property "${key}"` });
        }
      }
    }
    if (isSchemaObject(schema.properties)) {
      for (const [key, propertySchema] of Object.entries(schema.properties)) {
        if (key in record && isSchemaObject(propertySchema)) {
          issues.push(...checkJsonSchema(record[key], propertySchema, `${path}.${key}`));
        }
      }
    }
  }

  if (Array.isArray(value) && isSchemaObject(schema.items)) {
    value.forEach((item, index) => {
      issues.push(...checkJsonSchema(item, schema.items as Record<string, unknown>, `${path}[${index}]`));
    });
  }

  return issues;
};
