import ts from 'typescript';
import { collectExportedDeclarations, symbolPathOf } from './ts-ast.ts';

// Cited-value extraction — the SINGLE source of truth for both the valuePrints facet of the typed
// fingerprint ladder (extract-fingerprints.ts hashes exactly these strings) and the on-demand
// extractCitedValues() API the value-predicate verifier calls at verify time to compare a claim's
// asserted value against the code.
//
// Value-name grammar (claim subscriptions and the value-predicate verifier key on these names):
//
//   valueName :=
//     constName                                  exported const with a primitive initializer
//                                                ("DEFAULT_RETRIES")
//     constName '.' prop ('.' prop)*             primitive property of an exported object-literal
//                                                const; nested object literals extend the dot
//                                                path ("retryDefaults.backoff.factor")
//     enumName '.' memberName                    enum member value — explicit initializer or a
//                                                derivable numeric auto-increment ("LogLevel.Warn")
//     ownerPath '.param.' paramName '.default'   default parameter value; ownerPath is the
//                                                exported function name, "Class.method", or an
//                                                arrow/function-expression const
//                                                ("createClient.param.timeout.default")
//
// Normalized value strings: strings render as JSON (double-quoted, escaped — 'a', "a", and `a`
// normalize identically), numbers through Number() (1_000, 1e3, and 1000 normalize identically),
// booleans as true/false, null as null. Only literal-derived primitives are extracted — anything
// needing evaluation (identifier references, computed expressions, calls) is deliberately out:
// the verifier compares byte-wise, it never executes code.

export const unwrapExpression = (expression: ts.Expression): ts.Expression => {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
};

// Returns the normalized value string for a literal-derived primitive, undefined otherwise.
export const normalizePrimitiveValue = (expression: ts.Expression): string | undefined => {
  const expr = unwrapExpression(expression);
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
    return JSON.stringify(expr.text);
  }
  if (ts.isNumericLiteral(expr)) {
    return String(Number(expr.text));
  }
  if (ts.isPrefixUnaryExpression(expr) && ts.isNumericLiteral(expr.operand)) {
    if (expr.operator === ts.SyntaxKind.MinusToken) {
      return String(-Number(expr.operand.text));
    }
    return expr.operator === ts.SyntaxKind.PlusToken ? String(Number(expr.operand.text)) : undefined;
  }
  if (expr.kind === ts.SyntaxKind.TrueKeyword) {
    return 'true';
  }
  if (expr.kind === ts.SyntaxKind.FalseKeyword) {
    return 'false';
  }
  return expr.kind === ts.SyntaxKind.NullKeyword ? 'null' : undefined;
};

const propertyKeyOf = (name: ts.PropertyName): string | undefined =>
  ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) ? name.text : undefined;

const collectObjectLiteralValues = (
  path: string,
  literal: ts.ObjectLiteralExpression,
  into: Record<string, string>
): void => {
  for (const property of literal.properties) {
    // Shorthand/spread/method/computed properties are not literal-derived — skipped.
    if (!ts.isPropertyAssignment(property)) {
      continue;
    }
    const key = propertyKeyOf(property.name);
    if (key === undefined) {
      continue;
    }
    const value = unwrapExpression(property.initializer);
    if (ts.isObjectLiteralExpression(value)) {
      collectObjectLiteralValues(`${path}.${key}`, value, into);
      continue;
    }
    const normalized = normalizePrimitiveValue(value);
    if (normalized !== undefined) {
      into[`${path}.${key}`] = normalized;
    }
  }
};

const collectParameterDefaults = (
  ownerPath: string,
  parameters: readonly ts.ParameterDeclaration[],
  into: Record<string, string>
): void => {
  for (const parameter of parameters) {
    // Destructured parameters have no citable name; non-primitive defaults need evaluation.
    if (!ts.isIdentifier(parameter.name) || parameter.initializer === undefined) {
      continue;
    }
    const normalized = normalizePrimitiveValue(parameter.initializer);
    if (normalized !== undefined) {
      into[`${ownerPath}.param.${parameter.name.text}.default`] = normalized;
    }
  }
};

const collectEnumValues = (enumDeclaration: ts.EnumDeclaration, into: Record<string, string>): void => {
  // TS auto-increment: implicit members continue from the previous numeric value. After a
  // non-literal initializer the sequence is unknowable syntactically — subsequent implicit
  // members are skipped rather than guessed.
  let next: number | undefined = 0;
  for (const member of enumDeclaration.members) {
    const name = propertyKeyOf(member.name);
    if (member.initializer === undefined) {
      if (name !== undefined && next !== undefined) {
        into[`${enumDeclaration.name.text}.${name}`] = String(next);
      }
      next = next === undefined ? undefined : next + 1;
      continue;
    }
    const normalized = normalizePrimitiveValue(member.initializer);
    if (normalized !== undefined && name !== undefined) {
      into[`${enumDeclaration.name.text}.${name}`] = normalized;
    }
    const numeric = normalized === undefined ? Number.NaN : Number(normalized);
    next = Number.isFinite(numeric) ? numeric + 1 : undefined;
  }
};

// All cited values of one source file, grouped by the owning symbol's path (ts-ast symbolPathOf):
// "retryDefaults" → { "retryDefaults.maxAttempts": "3", … }.
export const collectCitedValues = (sourceFile: ts.SourceFile, file: string): Map<string, Record<string, string>> => {
  const bySymbol = new Map<string, Record<string, string>>();
  for (const declaration of collectExportedDeclarations(sourceFile, file)) {
    const path = symbolPathOf(declaration, file);
    const values: Record<string, string> = {};
    if (declaration.kind === 'function' && ts.isFunctionDeclaration(declaration.node)) {
      collectParameterDefaults(path, declaration.node.parameters, values);
    } else if (declaration.kind === 'method' && ts.isMethodDeclaration(declaration.node)) {
      collectParameterDefaults(path, declaration.node.parameters, values);
    } else if (declaration.kind === 'enum' && ts.isEnumDeclaration(declaration.node)) {
      collectEnumValues(declaration.node, values);
    } else if (declaration.kind === 'variable' && declaration.variable?.initializer !== undefined) {
      const initializer = unwrapExpression(declaration.variable.initializer);
      if (ts.isObjectLiteralExpression(initializer)) {
        collectObjectLiteralValues(path, initializer, values);
      } else if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
        collectParameterDefaults(path, initializer.parameters, values);
      } else {
        const normalized = normalizePrimitiveValue(initializer);
        if (normalized !== undefined) {
          values[path] = normalized;
        }
      }
    }
    if (Object.keys(values).length > 0) {
      bySymbol.set(path, values);
    }
  }
  return bySymbol;
};

export type ExtractCitedValuesInput = {
  // Repo-relative POSIX path — value names for module-level symbols do not embed it, but the
  // parser needs it for module segmentation and .tsx dialect detection.
  file: string;
  content: string;
  // Restrict to one symbol's values: the symbol path ("retryDefaults", "Counter.increment").
  symbol?: string;
};

// On-demand extraction for the value-predicate verifier: value name → NORMALIZED VALUE STRING
// (the actual values, not hashes). Guaranteed identical normalization to what valuePrints hash.
export const extractCitedValues = (input: ExtractCitedValuesInput): Record<string, string> => {
  const scriptKind = input.file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(input.file, input.content, ts.ScriptTarget.ES2022, true, scriptKind);
  const entries: Array<[string, string]> = [];
  for (const [path, values] of collectCitedValues(sourceFile, input.file)) {
    if (input.symbol !== undefined && path !== input.symbol && !path.startsWith(`${input.symbol}.`)) {
      continue;
    }
    entries.push(...Object.entries(values));
  }
  return Object.fromEntries(entries.toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
};
