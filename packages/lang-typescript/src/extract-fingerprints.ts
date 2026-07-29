import { normalizeDeclaration } from '@docstube/codemap';
import type { PackFingerprints } from '@docstube/codemap';
import { serializeSchemaShape, sha256Hex, symbolFingerprintSchema } from '@docstube/contracts';
import type { DeclaredSchemaShape, SymbolFingerprint } from '@docstube/contracts';
import type { LanguagePackContext } from '@docstube/plugin-sdk';
import ts from 'typescript';
import { collectCitedValues, unwrapExpression } from './cited-values.ts';
import { collectSchemaShapes } from './schema-shape.ts';
import type { ExportedDeclaration } from './ts-ast.ts';
import {
  collectExportedDeclarations,
  createVirtualProgram,
  isDeclarationFile,
  isPublicClassMember,
  symbolPathOf
} from './ts-ast.ts';

// Typed fingerprint emission (ARCHITECTURE.md §7.2): up to three prints per exported symbol.
//
// - signaturePrint — sha256 over the NORMALIZED public shape: modifiers, name, type params,
//   params with types and OPTIONALITY (a defaulted param prints as optional; the default VALUE is
//   a value facet, not a shape facet), return type. Stable under body-only and default-value
//   edits. `export`/`declare`/`default` modifiers are excluded so `export function f` and
//   `function f` + `export { f }` (and the .d.ts `declare` twin) print identically.
// - valuePrints — sha256 of each normalized cited-value string (cited-values.ts owns the value
//   names and normalization; this module only hashes).
// - bodyPrint — sha256 of the normalized implementation text (comment/whitespace-insensitive;
//   object-literal initializers serialize with SORTED keys so pure key reordering is invisible).
//
// .d.ts files emit signature prints only — they are pure signatures.

const langId = 'ts';

const print = (normalizedText: string): string => sha256Hex(normalizedText);

const normalizedText = (node: ts.Node, sourceFile: ts.SourceFile): string =>
  normalizeDeclaration(node.getText(sourceFile));

// Shape-relevant modifiers only: exportedness is a given for extracted symbols and `declare` is a
// .d.ts artifact, so both are dropped to keep prints comparable across export styles.
const signatureModifiers = (node: ts.Node): string[] =>
  (ts.canHaveModifiers(node) ? (ts.getModifiers(node) ?? []) : [])
    .filter(
      (modifier) =>
        modifier.kind !== ts.SyntaxKind.ExportKeyword &&
        modifier.kind !== ts.SyntaxKind.DeclareKeyword &&
        modifier.kind !== ts.SyntaxKind.DefaultKeyword
    )
    .map((modifier) => modifier.getText());

const typeParametersText = (
  node: { typeParameters?: ts.NodeArray<ts.TypeParameterDeclaration> | undefined },
  sourceFile: ts.SourceFile
): string =>
  node.typeParameters !== undefined && node.typeParameters.length > 0
    ? `<${node.typeParameters.map((typeParameter) => normalizedText(typeParameter, sourceFile)).join(',')}>`
    : '';

const parameterText = (parameter: ts.ParameterDeclaration, sourceFile: ts.SourceFile): string => {
  const rest = parameter.dotDotDotToken !== undefined ? '...' : '';
  // A default makes the parameter optional to callers; the default VALUE itself is a value facet.
  const optional = parameter.questionToken !== undefined || parameter.initializer !== undefined ? '?' : '';
  const type = parameter.type !== undefined ? `:${normalizedText(parameter.type, sourceFile)}` : '';
  return `${rest}${normalizedText(parameter.name, sourceFile)}${optional}${type}`;
};

const parametersText = (parameters: readonly ts.ParameterDeclaration[], sourceFile: ts.SourceFile): string =>
  `(${parameters.map((parameter) => parameterText(parameter, sourceFile)).join(',')})`;

const returnTypeText = (node: { type?: ts.TypeNode | undefined }, sourceFile: ts.SourceFile): string =>
  node.type !== undefined ? `:${normalizedText(node.type, sourceFile)}` : '';

const functionSignature = (node: ts.FunctionDeclaration, name: string, sourceFile: ts.SourceFile): string =>
  [
    ...signatureModifiers(node),
    'function',
    `${name}${typeParametersText(node, sourceFile)}${parametersText(node.parameters, sourceFile)}${returnTypeText(node, sourceFile)}`
  ].join(' ');

const memberSignature = (member: ts.ClassElement, sourceFile: ts.SourceFile): string | undefined => {
  if (ts.isConstructorDeclaration(member)) {
    return `constructor${parametersText(member.parameters, sourceFile)}`;
  }
  if (ts.isIndexSignatureDeclaration(member)) {
    return normalizedText(member, sourceFile);
  }
  if (member.name === undefined) {
    return undefined;
  }
  const name = member.name.getText(sourceFile);
  const modifiers = signatureModifiers(member);
  if (ts.isMethodDeclaration(member)) {
    return [
      ...modifiers,
      `${name}${typeParametersText(member, sourceFile)}${parametersText(member.parameters, sourceFile)}${returnTypeText(member, sourceFile)}`
    ].join(' ');
  }
  if (ts.isGetAccessorDeclaration(member)) {
    return [...modifiers, `get ${name}()${returnTypeText(member, sourceFile)}`].join(' ');
  }
  if (ts.isSetAccessorDeclaration(member)) {
    return [...modifiers, `set ${name}${parametersText(member.parameters, sourceFile)}`].join(' ');
  }
  if (ts.isPropertyDeclaration(member)) {
    const optional = member.questionToken !== undefined ? '?' : '';
    const type = member.type !== undefined ? `:${normalizedText(member.type, sourceFile)}` : '';
    return [...modifiers, `${name}${optional}${type}`].join(' ');
  }
  return undefined;
};

// A class's shape is its heading plus its PUBLIC member signatures, sorted so member reordering
// is not a shape change. Member bodies are excluded — they belong to the body facet.
const classSignature = (node: ts.ClassDeclaration, name: string, sourceFile: ts.SourceFile): string => {
  const heritage = (node.heritageClauses ?? []).map((clause) => normalizedText(clause, sourceFile)).join(' ');
  const members = node.members
    .filter((member) => isPublicClassMember(member))
    .map((member) => memberSignature(member, sourceFile))
    .filter((signature): signature is string => signature !== undefined)
    .toSorted();
  return [
    ...signatureModifiers(node),
    'class',
    `${name}${typeParametersText(node, sourceFile)}`,
    heritage,
    `{${members.join(';')}}`
  ]
    .filter((part) => part.length > 0)
    .join(' ');
};

// Enum shape = member NAMES; member values are value facets.
const enumSignature = (node: ts.EnumDeclaration, sourceFile: ts.SourceFile): string =>
  [
    ...signatureModifiers(node),
    'enum',
    `${node.name.text}{${node.members.map((member) => member.name.getText(sourceFile)).join(',')}}`
  ].join(' ');

// Interfaces and type aliases are pure types — the whole declaration (sans leading modifiers) is
// the signature. Member order participates: conservative, but a reorder there is rare.
const declarationWithoutModifiers = (node: ts.Node, sourceFile: ts.SourceFile): string => {
  const modifiers = ts.canHaveModifiers(node) ? (ts.getModifiers(node) ?? []) : [];
  const last = modifiers.at(-1);
  const start = last === undefined ? node.getStart(sourceFile) : last.end;
  return sourceFile.text.slice(start, node.getEnd());
};

const functionLikeInitializer = (
  declaration: ts.VariableDeclaration
): ts.ArrowFunction | ts.FunctionExpression | undefined => {
  if (declaration.initializer === undefined) {
    return undefined;
  }
  const initializer = unwrapExpression(declaration.initializer);
  return ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer) ? initializer : undefined;
};

const variableSignature = (declaration: ts.VariableDeclaration, sourceFile: ts.SourceFile): string => {
  const flags = ts.getCombinedNodeFlags(declaration);
  const keyword = (flags & ts.NodeFlags.Const) !== 0 ? 'const' : (flags & ts.NodeFlags.Let) !== 0 ? 'let' : 'var';
  const type = declaration.type !== undefined ? `:${normalizedText(declaration.type, sourceFile)}` : '';
  const fn = functionLikeInitializer(declaration);
  const fnSignature =
    fn === undefined
      ? ''
      : `=${typeParametersText(fn, sourceFile)}${parametersText(fn.parameters, sourceFile)}${returnTypeText(fn, sourceFile)}=>`;
  return `${keyword} ${declaration.name.getText(sourceFile)}${type}${fnSignature}`;
};

const signatureTextOf = (declaration: ExportedDeclaration, sourceFile: ts.SourceFile): string => {
  const node = declaration.node;
  if (declaration.kind === 'function' && ts.isFunctionDeclaration(node)) {
    return functionSignature(node, declaration.name, sourceFile);
  }
  if ((declaration.kind === 'method' || declaration.kind === 'property') && ts.isClassElement(node)) {
    return memberSignature(node, sourceFile) ?? normalizedText(node, sourceFile);
  }
  if (declaration.kind === 'class' && ts.isClassDeclaration(node)) {
    return classSignature(node, declaration.name, sourceFile);
  }
  if (declaration.kind === 'enum' && ts.isEnumDeclaration(node)) {
    return enumSignature(node, sourceFile);
  }
  if (declaration.kind === 'variable' && declaration.variable !== undefined) {
    return variableSignature(declaration.variable, sourceFile);
  }
  // interface / type alias (and any future kind): the declaration text is the signature.
  return declarationWithoutModifiers(node, sourceFile);
};

// Canonical text for initializer expressions feeding the body facet: object literals serialize
// with sorted keys (pure key reordering is not a change), arrays keep element order (order is
// meaningful), everything else is comment/whitespace-normalized source text.
const canonicalExpressionText = (expression: ts.Expression, sourceFile: ts.SourceFile): string => {
  const expr = unwrapExpression(expression);
  if (ts.isObjectLiteralExpression(expr)) {
    const entries = expr.properties
      .map((property) => {
        if (
          ts.isPropertyAssignment(property) &&
          (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) || ts.isNumericLiteral(property.name))
        ) {
          return `${property.name.text}:${canonicalExpressionText(property.initializer, sourceFile)}`;
        }
        return normalizedText(property, sourceFile);
      })
      .toSorted();
    return `{${entries.join(',')}}`;
  }
  if (ts.isArrayLiteralExpression(expr)) {
    return `[${expr.elements.map((element) => canonicalExpressionText(element, sourceFile)).join(',')}]`;
  }
  return normalizedText(expr, sourceFile);
};

const bodyTextOf = (declaration: ExportedDeclaration, sourceFile: ts.SourceFile): string | undefined => {
  const node = declaration.node;
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  ) {
    return node.body === undefined ? undefined : normalizedText(node.body, sourceFile);
  }
  // The class body facet is the full declaration text: any member (body) edit changes it, while
  // the class signaturePrint holds — exactly the split shape claims rely on.
  if (declaration.kind === 'class') {
    return normalizedText(node, sourceFile);
  }
  if (declaration.kind === 'property' && ts.isPropertyDeclaration(node) && node.initializer !== undefined) {
    return canonicalExpressionText(node.initializer, sourceFile);
  }
  if (declaration.kind === 'variable' && declaration.variable?.initializer !== undefined) {
    const fn = functionLikeInitializer(declaration.variable);
    if (fn !== undefined) {
      return fn.body === undefined ? undefined : normalizedText(fn.body, sourceFile);
    }
    const initializer = unwrapExpression(declaration.variable.initializer);
    // A primitive initializer is fully captured by its valuePrint — no separate body facet, so a
    // default-value edit moves exactly one print.
    if (
      ts.isStringLiteral(initializer) ||
      ts.isNoSubstitutionTemplateLiteral(initializer) ||
      ts.isNumericLiteral(initializer) ||
      initializer.kind === ts.SyntaxKind.TrueKeyword ||
      initializer.kind === ts.SyntaxKind.FalseKeyword ||
      initializer.kind === ts.SyntaxKind.NullKeyword
    ) {
      return undefined;
    }
    return canonicalExpressionText(initializer, sourceFile);
  }
  // interface / type / enum: pure signatures, no body facet.
  return undefined;
};

const fingerprintOf = (input: {
  declaration: ExportedDeclaration;
  sourceFile: ts.SourceFile;
  file: string;
  hashSymbol: LanguagePackContext['hashSymbol'];
  citedValues: Map<string, Record<string, string>>;
  schemaShapes: Map<string, DeclaredSchemaShape>;
  signatureOnly: boolean;
}): SymbolFingerprint => {
  const { declaration, sourceFile, file } = input;
  const symbolHash = input.hashSymbol({
    lang: langId,
    kind: declaration.kind,
    containerPath: declaration.containerPath,
    normalizedDeclaration: normalizedText(declaration.node, sourceFile)
  });
  const candidate: Record<string, unknown> = {
    symbolHash,
    signaturePrint: print(normalizeDeclaration(signatureTextOf(declaration, sourceFile)))
  };
  if (!input.signatureOnly) {
    const values = input.citedValues.get(symbolPathOf(declaration, file));
    if (values !== undefined) {
      candidate.valuePrints = Object.fromEntries(
        Object.entries(values)
          .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([name, normalizedValue]) => [name, print(normalizedValue)])
      );
    }
    const bodyText = bodyTextOf(declaration, sourceFile);
    if (bodyText !== undefined) {
      candidate.bodyPrint = print(normalizeDeclaration(bodyText));
    }
    // The declared-schema facet: present only for readable validation-schema declarations. The
    // verifier hashes its own re-extraction against this print, so schema evidence is never minted
    // from bytes the run's snapshot never saw.
    const shape = input.schemaShapes.get(symbolPathOf(declaration, file));
    if (shape !== undefined) {
      candidate.schemaShapePrint = print(serializeSchemaShape(shape));
    }
  }
  return symbolFingerprintSchema.parse(candidate);
};

// Emits one fingerprint per exported symbol across the pack's files, .d.ts included (signature
// prints only there). `parsedFiles` lists the files the prints fully cover; files that fail to
// parse OR export nothing are left to the host's whole-file fallback — a parse that found no
// documentable surface must not hide the file's changes.
export const extractFingerprints = async (ctx: LanguagePackContext): Promise<PackFingerprints> => {
  const contents = await Promise.all(ctx.files.map((file) => ctx.readFile(file)));
  const sources = new Map(ctx.files.map((file, index) => [file, contents[index] ?? '']));
  const program = createVirtualProgram(ctx.repoRoot, sources);
  const symbols: SymbolFingerprint[] = [];
  const parsedFiles: string[] = [];
  for (const file of sources.keys()) {
    const sourceFile = program.getSourceFile(file);
    if (!sourceFile) {
      ctx.logger.warn(`lang-typescript: could not fingerprint ${file}, leaving it on whole-file fallback`);
      continue;
    }
    const declarations = collectExportedDeclarations(sourceFile, file);
    if (declarations.length === 0) {
      continue;
    }
    const signatureOnly = isDeclarationFile(file);
    const citedValues = signatureOnly
      ? new Map<string, Record<string, string>>()
      : collectCitedValues(sourceFile, file);
    const schemaShapes = signatureOnly ? new Map<string, DeclaredSchemaShape>() : collectSchemaShapes(sourceFile, file);
    for (const declaration of declarations) {
      symbols.push(
        fingerprintOf({
          declaration,
          sourceFile,
          file,
          hashSymbol: ctx.hashSymbol,
          citedValues,
          schemaShapes,
          signatureOnly
        })
      );
    }
    parsedFiles.push(file);
  }
  return { symbols, parsedFiles };
};
