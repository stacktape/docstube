import { normalizeDeclaration } from '@docstube/codemap';
import type { SymbolRecord } from '@docstube/contracts';
import type { LanguagePackContext } from '@docstube/plugin-sdk';
import type ts from 'typescript';
import { collectExportedDeclarations, createVirtualProgram, isDeclarationFile } from './ts-ast.ts';

// TypeScript symbol extraction via the compiler API (not TypeDoc, not tree-sitter): we need
// declarations, spans, and normalized text — not rendered docs — and the compiler API gives us
// that with zero extra moving parts. The exported-declaration walk itself is shared with
// fingerprint emission (ts-ast.ts) so both paths always agree on the symbol set and hash input.

const langId = 'ts';
const signatureMaxLength = 200;

type HashSymbolFn = LanguagePackContext['hashSymbol'];

const spanOf = (sourceFile: ts.SourceFile, node: ts.Node): [number, number] => [
  sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
  sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1
];

const buildRecord = (input: {
  hashSymbol: HashSymbolFn;
  sourceFile: ts.SourceFile;
  file: string;
  kind: string;
  name: string;
  containerPath: string[];
  node: ts.Node;
}): SymbolRecord => {
  // The hash covers the FULL declaration text (comments/whitespace normalized away). For classes
  // that includes member bodies, so a member edit also changes the class hash — pessimistic on
  // purpose: entities citing the class regenerate when its implementation shifts.
  const declarationText = input.node.getText(input.sourceFile);
  const normalizedDeclaration = normalizeDeclaration(declarationText);
  // Display signature stays human-readable (hash normalization strips token spacing).
  const firstLine =
    declarationText
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? '';
  return {
    hash: input.hashSymbol({
      lang: langId,
      kind: input.kind,
      containerPath: input.containerPath,
      normalizedDeclaration
    }),
    lang: langId,
    kind: input.kind,
    name: input.name,
    containerPath: input.containerPath,
    file: input.file,
    span: spanOf(input.sourceFile, input.node),
    visibility: 'public',
    signature: firstLine.replaceAll(/\s+/gu, ' ').slice(0, signatureMaxLength),
    project: '.'
  };
};

const extractFileSymbols = (sourceFile: ts.SourceFile, file: string, hashSymbol: HashSymbolFn): SymbolRecord[] =>
  collectExportedDeclarations(sourceFile, file).map((declaration) =>
    buildRecord({
      hashSymbol,
      sourceFile,
      file,
      kind: declaration.kind,
      name: declaration.name,
      containerPath: declaration.containerPath,
      node: declaration.node
    })
  );

export const extractSymbols = async (ctx: LanguagePackContext): Promise<SymbolRecord[]> => {
  // .d.ts files are generated output, not source truth — skip them.
  const sourceFiles = ctx.files.filter((file) => !isDeclarationFile(file));
  const contents = await Promise.all(sourceFiles.map((file) => ctx.readFile(file)));
  const sources = new Map(sourceFiles.map((file, index) => [file, contents[index] ?? '']));
  const program = createVirtualProgram(ctx.repoRoot, sources);
  const records: SymbolRecord[] = [];
  for (const file of sources.keys()) {
    const sourceFile = program.getSourceFile(file);
    if (!sourceFile) {
      ctx.logger.warn(`lang-typescript: could not parse ${file}, skipping`);
      continue;
    }
    records.push(...extractFileSymbols(sourceFile, file, ctx.hashSymbol));
  }
  return records;
};
