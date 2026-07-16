import { normalizeDeclaration } from '@docstube/codemap';
import type { SymbolRecord } from '@docstube/contracts';
import type { LanguagePackContext } from '@docstube/plugin-sdk';
import ts from 'typescript';

// TypeScript symbol extraction via the compiler API (not TypeDoc, not tree-sitter): we need
// declarations, spans, and normalized text — not rendered docs — and the compiler API gives us
// that with zero extra moving parts. Only EXPORTED top-level declarations and their public class
// members are emitted; internal helpers are not documentable API surface.

const langId = 'ts';
const signatureMaxLength = 200;
const extensionPattern = /\.(?:tsx|mts|cts|ts)$/u;

type HashSymbolFn = LanguagePackContext['hashSymbol'];

const moduleSegments = (repoRelativePath: string): string[] =>
  repoRelativePath.replace(extensionPattern, '').split('/');

const toPosix = (path: string): string => path.replaceAll('\\', '/');

const isDeclarationFile = (file: string): boolean => /\.d\.(?:ts|mts|cts)$/u.test(file);

// Minimal virtual program: sources come from the pack context (never straight from disk, so the
// host controls what is read), no lib, no module resolution — extraction is purely syntactic.
const createVirtualProgram = (repoRoot: string, sources: Map<string, string>): ts.Program => {
  const options: ts.CompilerOptions = {
    allowJs: false,
    noEmit: true,
    noLib: true,
    noResolve: true,
    skipLibCheck: true,
    strict: false,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext
  };
  const host: ts.CompilerHost = {
    fileExists: (fileName) => sources.has(toPosix(fileName)),
    readFile: (fileName) => sources.get(toPosix(fileName)),
    getSourceFile: (fileName, languageVersionOrOptions) => {
      const content = sources.get(toPosix(fileName));
      return content === undefined ? undefined : ts.createSourceFile(fileName, content, languageVersionOrOptions, true);
    },
    getDefaultLibFileName: () => 'lib.d.ts',
    writeFile: () => {},
    getCurrentDirectory: () => repoRoot,
    getCanonicalFileName: (fileName) => fileName,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n'
  };
  return ts.createProgram([...sources.keys()], options, host);
};

const hasExportModifier = (node: ts.Node): boolean =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

// Names exported via a separate `export { a, b }` statement (no module specifier — re-exports of
// other modules are that module's symbols, not this file's).
const collectExportListNames = (sourceFile: ts.SourceFile): Set<string> => {
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier === undefined &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        names.add((element.propertyName ?? element.name).text);
      }
    }
  }
  return names;
};

const isExported = (statement: ts.Statement, name: string | undefined, exportListNames: Set<string>): boolean =>
  hasExportModifier(statement) || (name !== undefined && exportListNames.has(name));

const isPublicClassMember = (member: ts.ClassElement): boolean => {
  const modifiers = ts.canHaveModifiers(member) ? (ts.getModifiers(member) ?? []) : [];
  const hasAccessModifier = modifiers.some(
    (m) => m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword
  );
  const hasPrivateName = member.name !== undefined && ts.isPrivateIdentifier(member.name);
  return !hasAccessModifier && !hasPrivateName;
};

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

const extractClassMembers = (input: {
  hashSymbol: HashSymbolFn;
  sourceFile: ts.SourceFile;
  file: string;
  classNode: ts.ClassDeclaration;
  containerPath: string[];
}): SymbolRecord[] => {
  const records: SymbolRecord[] = [];
  for (const member of input.classNode.members) {
    if (!isPublicClassMember(member) || member.name === undefined) {
      continue;
    }
    const name = member.name.getText(input.sourceFile);
    if (ts.isMethodDeclaration(member) || ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) {
      records.push(
        buildRecord({
          hashSymbol: input.hashSymbol,
          sourceFile: input.sourceFile,
          file: input.file,
          kind: 'method',
          name,
          containerPath: input.containerPath,
          node: member
        })
      );
    } else if (ts.isPropertyDeclaration(member)) {
      records.push(
        buildRecord({
          hashSymbol: input.hashSymbol,
          sourceFile: input.sourceFile,
          file: input.file,
          kind: 'property',
          name,
          containerPath: input.containerPath,
          node: member
        })
      );
    }
  }
  return records;
};

const extractFileSymbols = (sourceFile: ts.SourceFile, file: string, hashSymbol: HashSymbolFn): SymbolRecord[] => {
  const containerPath = moduleSegments(file);
  const exportListNames = collectExportListNames(sourceFile);
  const records: SymbolRecord[] = [];
  const build = (kind: string, name: string, node: ts.Node, container: string[] = containerPath): SymbolRecord =>
    buildRecord({ hashSymbol, sourceFile, file, kind, name, containerPath: container, node });

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement)) {
      if (!isExported(statement, statement.name?.text, exportListNames)) {
        continue;
      }
      records.push(build('function', statement.name?.text ?? 'default', statement));
    } else if (ts.isClassDeclaration(statement)) {
      if (!isExported(statement, statement.name?.text, exportListNames)) {
        continue;
      }
      const className = statement.name?.text ?? 'default';
      records.push(build('class', className, statement));
      records.push(
        ...extractClassMembers({
          hashSymbol,
          sourceFile,
          file,
          classNode: statement,
          containerPath: [...containerPath, className]
        })
      );
    } else if (ts.isInterfaceDeclaration(statement)) {
      if (!isExported(statement, statement.name.text, exportListNames)) {
        continue;
      }
      records.push(build('interface', statement.name.text, statement));
    } else if (ts.isTypeAliasDeclaration(statement)) {
      if (!isExported(statement, statement.name.text, exportListNames)) {
        continue;
      }
      records.push(build('type', statement.name.text, statement));
    } else if (ts.isEnumDeclaration(statement)) {
      if (!isExported(statement, statement.name.text, exportListNames)) {
        continue;
      }
      records.push(build('enum', statement.name.text, statement));
    } else if (ts.isVariableStatement(statement)) {
      const statementExported = hasExportModifier(statement);
      const declarations = statement.declarationList.declarations;
      for (const declaration of declarations) {
        if (!ts.isIdentifier(declaration.name)) {
          continue;
        }
        const name = declaration.name.text;
        if (!statementExported && !exportListNames.has(name)) {
          continue;
        }
        // Single-declaration statements (the common case) hash the whole statement so the
        // const/let keyword participates; multi-declaration statements fall back per declaration.
        records.push(build('variable', name, declarations.length === 1 ? statement : declaration));
      }
    }
  }
  return records;
};

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
