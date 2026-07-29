import { z } from 'zod';

// DECLARED SCHEMA SHAPE — the statically extracted shape of a validation-schema declaration
// (impl-16 gap 3). Config and API reference pages are mostly claims ABOUT schemas ("the config
// requires `docType`", "`agents.transport` defaults to `claude-cli`"), which are mechanically
// checkable facts that nothing extracted before: the value ladder only sees plain object literals,
// and codemap grounding only proves the schema symbol exists.
//
// A shape is produced by a LANGUAGE PACK from the AST alone — NEVER by evaluating code. Anything
// the parser cannot read statically is simply absent from the record, and an absent fact leaves
// the claim unchecked. The record is deliberately small: field presence, field optionality, and a
// literal default when one is spelled as a literal.
//
//   kind 'object'  a field map: z.object / z.strictObject / z.looseObject and equivalents. Nested
//                  INLINE object schemas extend the dot path ('budgets.maxRunUsd').
//   kind 'enum'    a member set: z.enum([...]) and equivalents. Members are recorded as fields so
//                  presence assertions ("`transportIdSchema` defines `claude-cli`") read the same
//                  index; they are never optional and never carry defaults.

export const schemaShapeFieldSchema = z.object({
  // Input-optional: the field may be omitted by a caller — an explicit optional marker, a default,
  // or a prefault. Required fields are the ones a caller MUST supply.
  optional: z.boolean(),
  // The field's default in the canonical cited-value spelling (strings JSON-quoted, numbers via
  // Number(), booleans/null bare) — present ONLY when the default is a static literal.
  defaultValue: z.string().optional(),
  // True when the field HAS a default whose expression is not a static literal (a call, an
  // identifier, an object/array literal). The distinction matters: 'no default' and 'a default the
  // parser cannot read' must never be conflated into a guessed value.
  defaultUnknown: z.boolean().default(false)
});
export type SchemaShapeField = z.infer<typeof schemaShapeFieldSchema>;

export const declaredSchemaShapeSchema = z.object({
  kind: z.enum(['object', 'enum']),
  // Dot-joined field path → field facts. Enum members are single-segment paths.
  fields: z.record(z.string().min(1), schemaShapeFieldSchema).default({})
});
export type DeclaredSchemaShape = z.infer<typeof declaredSchemaShapeSchema>;

// CANONICAL SERIALIZATION — the exact bytes the schemaShapePrint facet hashes. It lives here, next
// to the schema, so the language pack that emits the print and the kernel that re-checks it can
// never drift into two spellings of "the same shape". Field order is sorted, so pure reordering in
// the source is not a change.
export const serializeSchemaShape = (shape: DeclaredSchemaShape): string =>
  JSON.stringify([
    shape.kind,
    Object.entries(shape.fields)
      .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([path, field]) => [path, field.optional, field.defaultValue ?? null, field.defaultUnknown])
  ]);

// FIELD RESOLUTION (shared by the kernel verifier and any pack-side tooling): a claim spells a
// field the way the docs read it — usually the bare leaf name ('maxRunUsd'), sometimes the full
// nested path ('budgets.maxRunUsd'). Exact path wins; otherwise the leaf must be UNIQUE across the
// shape. Two fields with the same leaf name leave the claim unchecked — the kernel never guesses
// which nesting the sentence meant.
export const resolveSchemaField = (
  shape: DeclaredSchemaShape,
  spelling: string
): { path: string; field: SchemaShapeField } | undefined => {
  const exact = shape.fields[spelling];
  if (exact !== undefined) {
    return { path: spelling, field: exact };
  }
  const matches = Object.entries(shape.fields).filter(([path]) => path.split('.').at(-1) === spelling);
  const only = matches.length === 1 ? matches[0] : undefined;
  return only === undefined ? undefined : { path: only[0], field: only[1] };
};
