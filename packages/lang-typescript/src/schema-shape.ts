import type { DeclaredSchemaShape, SchemaShapeField } from '@docstube/contracts';
import ts from 'typescript';
import { normalizePrimitiveValue, unwrapExpression } from './cited-values.ts';
import { collectExportedDeclarations, symbolPathOf } from './ts-ast.ts';

// SCHEMA-SHAPE EXTRACTION — the third facet of the TypeScript pack's static reading (after symbols
// and cited values), and the one that makes config/API reference documentation checkable.
//
// The single largest group of documented facts about a validated surface is its SHAPE: which
// fields a schema has, which of them a caller must supply, and what the optional ones default to.
// Those are mechanically decidable from the declaration — but the cited-value ladder only reads
// plain object literals, so a `z.object({...})` was opaque and every such claim shipped unchecked.
//
// PURELY SYNTACTIC, NEVER EVALUATED. The extractor reads the AST and nothing else: no schema is
// constructed, no `.parse` is called, no module is loaded. What the parser cannot read statically
// is ABSENT from the record, and the kernel treats absence as unresolvable — never as a fact.
//
// FAIL-CLOSED IN THREE PLACES:
//   1. the FACTORY must be recognized (`z.object` / `z.strictObject` / `z.looseObject` /
//      `z.enum`), and its argument must be a literal — `z.object(buildFields())` reads as no shape
//      at all rather than an empty one;
//   2. every method chained onto the schema must be SHAPE-PRESERVING. `.superRefine`, `.describe`,
//      `.default`, `.prefault` and friends leave the field set alone; `.extend`, `.merge`,
//      `.partial`, `.pick`, `.omit`, `.required` and anything unrecognized REDEFINE it, so the
//      whole record is refused rather than reported stale;
//   3. a DEFAULT is recorded as a value only when its expression is a static literal. A default
//      that is a call, an identifier, or an object/array literal is recorded as
//      `defaultUnknown` — present, but unreadable — so 'no default' and 'a default we cannot read'
//      can never collapse into a guessed value.
//
// Nested INLINE object schemas extend the dot path ('budgets.maxRunUsd'). A field whose value is a
// reference to another schema symbol is recorded as a present field, but is NOT followed: the
// reference could be in another module, and inventing its subtree would be exactly the kind of
// guess the ladder exists to prevent.

const OBJECT_FACTORIES = new Set(['object', 'strictObject', 'looseObject']);
const ENUM_FACTORIES = new Set(['enum']);

// Methods that constrain, annotate, or wrap a schema WITHOUT changing which fields it accepts.
// Everything outside this set — including anything zod adds later — refuses the shape.
const SHAPE_PRESERVING_METHODS = new Set([
  'brand',
  'catch',
  'check',
  'clone',
  'default',
  'describe',
  'meta',
  'nullable',
  'nullish',
  'optional',
  'prefault',
  'readonly',
  'refine',
  'register',
  'superRefine'
]);

// Methods that make a field input-optional: the caller may leave it out.
const OPTIONALIZING_METHODS = new Set(['optional', 'nullish', 'default', 'prefault', 'catch']);

const DEFAULTING_METHODS = new Set(['default', 'prefault']);

type ChainLink = { method: string; call: ts.CallExpression };

// Unwinds `z.strictObject({…}).prefault({})` into links [prefault, strictObject] (OUTERMOST first)
// plus the receiver the chain hangs off (`z`, or another schema identifier).
const unwindChain = (expression: ts.Expression): { links: ChainLink[]; receiver: ts.Expression } => {
  const links: ChainLink[] = [];
  let current = unwrapExpression(expression);
  while (
    ts.isCallExpression(current) &&
    ts.isPropertyAccessExpression(current.expression) &&
    ts.isIdentifier(current.expression.name)
  ) {
    links.push({ method: current.expression.name.text, call: current });
    current = unwrapExpression(current.expression.expression);
  }
  return { links, receiver: current };
};

type SchemaCall = { factory: string; call: ts.CallExpression; modifiers: string[] };

// The recognized factory at the root of a chain, with the modifiers layered on top of it. Returns
// undefined when the innermost call is not a known factory (a reference to another schema, a
// primitive builder, an unreadable expression).
const schemaCallOf = (expression: ts.Expression): SchemaCall | undefined => {
  const { links } = unwindChain(expression);
  const innermost = links.at(-1);
  if (innermost === undefined) {
    return undefined;
  }
  if (!OBJECT_FACTORIES.has(innermost.method) && !ENUM_FACTORIES.has(innermost.method)) {
    return undefined;
  }
  return {
    factory: innermost.method,
    call: innermost.call,
    modifiers: links.slice(0, -1).map((link) => link.method)
  };
};

const propertyKeyOf = (name: ts.PropertyName): string | undefined =>
  ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) ? name.text : undefined;

// The optionality + default facts a field's own chain states, independent of what it wraps.
const fieldFactsOf = (expression: ts.Expression): SchemaShapeField => {
  const { links } = unwindChain(expression);
  const optional = links.some((link) => OPTIONALIZING_METHODS.has(link.method));
  // Zod applies the OUTERMOST default last, so it wins; links are already outermost-first.
  const defaulting = links.find((link) => DEFAULTING_METHODS.has(link.method));
  if (defaulting === undefined) {
    return { optional, defaultUnknown: false };
  }
  const argument = defaulting.call.arguments[0];
  const literal = argument === undefined ? undefined : normalizePrimitiveValue(argument);
  return literal === undefined
    ? { optional, defaultUnknown: true }
    : { optional, defaultValue: literal, defaultUnknown: false };
};

const collectObjectFields = (
  prefix: string,
  literal: ts.ObjectLiteralExpression,
  into: Record<string, SchemaShapeField>
): void => {
  for (const property of literal.properties) {
    // Spread, shorthand, computed, and method properties state no readable field — they are
    // skipped, and the fields they would have contributed simply stay absent (never contradicted).
    if (!ts.isPropertyAssignment(property)) {
      continue;
    }
    const key = propertyKeyOf(property.name);
    if (key === undefined) {
      continue;
    }
    const path = prefix === '' ? key : `${prefix}.${key}`;
    into[path] = fieldFactsOf(property.initializer);
    const nested = schemaCallOf(property.initializer);
    if (
      nested !== undefined &&
      OBJECT_FACTORIES.has(nested.factory) &&
      nested.modifiers.every((method) => SHAPE_PRESERVING_METHODS.has(method))
    ) {
      const argument = nested.call.arguments[0];
      if (argument !== undefined && ts.isObjectLiteralExpression(argument)) {
        collectObjectFields(path, argument, into);
      }
    }
  }
};

// The declared shape of ONE schema expression, or undefined when nothing readable is declared.
export const declaredShapeOf = (expression: ts.Expression): DeclaredSchemaShape | undefined => {
  const schemaCall = schemaCallOf(expression);
  if (schemaCall === undefined || !schemaCall.modifiers.every((method) => SHAPE_PRESERVING_METHODS.has(method))) {
    return undefined;
  }
  const argument = schemaCall.call.arguments[0];
  if (argument === undefined) {
    return undefined;
  }
  if (ENUM_FACTORIES.has(schemaCall.factory)) {
    if (!ts.isArrayLiteralExpression(argument)) {
      return undefined;
    }
    const fields: Record<string, SchemaShapeField> = {};
    for (const element of argument.elements) {
      const member = unwrapExpression(element);
      if (ts.isStringLiteral(member) || ts.isNoSubstitutionTemplateLiteral(member)) {
        fields[member.text] = { optional: false, defaultUnknown: false };
      }
    }
    // A member list the parser could not read end to end says nothing trustworthy about the set.
    return argument.elements.length === Object.keys(fields).length ? { kind: 'enum', fields } : undefined;
  }
  if (!ts.isObjectLiteralExpression(argument)) {
    return undefined;
  }
  const fields: Record<string, SchemaShapeField> = {};
  collectObjectFields('', argument, fields);
  return { kind: 'object', fields };
};

// Declared schema shapes of one source file, keyed by the owning symbol's path (ts-ast
// symbolPathOf) — the same key space cited values use.
export const collectSchemaShapes = (sourceFile: ts.SourceFile, file: string): Map<string, DeclaredSchemaShape> => {
  const shapes = new Map<string, DeclaredSchemaShape>();
  for (const declaration of collectExportedDeclarations(sourceFile, file)) {
    if (declaration.kind !== 'variable' || declaration.variable?.initializer === undefined) {
      continue;
    }
    const shape = declaredShapeOf(declaration.variable.initializer);
    if (shape !== undefined) {
      shapes.set(symbolPathOf(declaration, file), shape);
    }
  }
  return shapes;
};

export type ExtractSchemaShapesInput = {
  // Repo-relative POSIX path — needed for module segmentation and .tsx dialect detection.
  file: string;
  content: string;
  // Restrict to one symbol's shape: the symbol path ("docstubeConfigSchema").
  symbol?: string;
};

// On-demand extraction for the kernel's schema-shape verifier, duck-typed exactly like
// extractCitedValues: symbol path → declared shape.
export const extractSchemaShapes = (input: ExtractSchemaShapesInput): Record<string, DeclaredSchemaShape> => {
  const scriptKind = input.file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(input.file, input.content, ts.ScriptTarget.ES2022, true, scriptKind);
  const entries: Array<[string, DeclaredSchemaShape]> = [];
  for (const [path, shape] of collectSchemaShapes(sourceFile, input.file)) {
    if (input.symbol !== undefined && path !== input.symbol) {
      continue;
    }
    entries.push([path, shape]);
  }
  return Object.fromEntries(entries);
};
