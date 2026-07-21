import ts from 'typescript';

// Shared syntactic plumbing for the TypeScript pack: virtual-program construction, export
// detection, and the single exported-declaration walk that BOTH symbol extraction
// (extract-symbols.ts) and fingerprint emission (extract-fingerprints.ts) build on. Sharing the
// walk is load-bearing: the kernel symbol hash is computed over the same node's text in both
// paths, so fingerprints always join their symbol records.

const extensionPattern = /\.(?:tsx|mts|cts|ts)$/u;

export const moduleSegments = (repoRelativePath: string): string[] =>
  repoRelativePath.replace(extensionPattern, '').split('/');

const toPosix = (path: string): string => path.replaceAll('\\', '/');

export const isDeclarationFile = (file: string): boolean => /\.d\.(?:ts|mts|cts)$/u.test(file);

// Minimal virtual program: sources come from the pack context (never straight from disk, so the
// host controls what is read), no lib, no module resolution — extraction is purely syntactic.
export const createVirtualProgram = (repoRoot: string, sources: Map<string, string>): ts.Program => {
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

export const hasExportModifier = (node: ts.Node): boolean =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

// Names exported via a separate `export { a, b }` statement (no module specifier — re-exports of
// other modules are that module's symbols, not this file's).
export const collectExportListNames = (sourceFile: ts.SourceFile): Set<string> => {
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

export const isExported = (statement: ts.Statement, name: string | undefined, exportListNames: Set<string>): boolean =>
  hasExportModifier(statement) || (name !== undefined && exportListNames.has(name));

export const isPublicClassMember = (member: ts.ClassElement): boolean => {
  const modifiers = ts.canHaveModifiers(member) ? (ts.getModifiers(member) ?? []) : [];
  const hasAccessModifier = modifiers.some(
    (m) => m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword
  );
  const hasPrivateName = member.name !== undefined && ts.isPrivateIdentifier(member.name);
  return !hasAccessModifier && !hasPrivateName;
};

export type ExportedDeclaration = {
  kind: string;
  name: string;
  containerPath: string[];
  // The node whose full text feeds the kernel symbol hash AND the record span — identical to what
  // extract-symbols has always hashed (single-declaration variable statements hash the whole
  // statement so the const/let keyword participates).
  node: ts.Node;
  // For 'variable' declarations: the VariableDeclaration itself (name/type/initializer), needed
  // by fingerprint emission regardless of which node was hashed.
  variable?: ts.VariableDeclaration;
};

// The symbol's path within its file: `name` for top-level declarations, `Class.member` for class
// members. Value names (cited-values.ts) are prefixed with this path.
export const symbolPathOf = (declaration: ExportedDeclaration, file: string): string =>
  [...declaration.containerPath.slice(moduleSegments(file).length), declaration.name].join('.');

// Only EXPORTED top-level declarations and their public class members are emitted; internal
// helpers are not documentable API surface.
export const collectExportedDeclarations = (sourceFile: ts.SourceFile, file: string): ExportedDeclaration[] => {
  const containerPath = moduleSegments(file);
  const exportListNames = collectExportListNames(sourceFile);
  const declarations: ExportedDeclaration[] = [];
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement)) {
      if (!isExported(statement, statement.name?.text, exportListNames)) {
        continue;
      }
      declarations.push({ kind: 'function', name: statement.name?.text ?? 'default', containerPath, node: statement });
    } else if (ts.isClassDeclaration(statement)) {
      if (!isExported(statement, statement.name?.text, exportListNames)) {
        continue;
      }
      const className = statement.name?.text ?? 'default';
      declarations.push({ kind: 'class', name: className, containerPath, node: statement });
      for (const member of statement.members) {
        if (!isPublicClassMember(member) || member.name === undefined) {
          continue;
        }
        const memberName = member.name.getText(sourceFile);
        const memberPath = [...containerPath, className];
        if (
          ts.isMethodDeclaration(member) ||
          ts.isGetAccessorDeclaration(member) ||
          ts.isSetAccessorDeclaration(member)
        ) {
          declarations.push({ kind: 'method', name: memberName, containerPath: memberPath, node: member });
        } else if (ts.isPropertyDeclaration(member)) {
          declarations.push({ kind: 'property', name: memberName, containerPath: memberPath, node: member });
        }
      }
    } else if (ts.isInterfaceDeclaration(statement)) {
      if (!isExported(statement, statement.name.text, exportListNames)) {
        continue;
      }
      declarations.push({ kind: 'interface', name: statement.name.text, containerPath, node: statement });
    } else if (ts.isTypeAliasDeclaration(statement)) {
      if (!isExported(statement, statement.name.text, exportListNames)) {
        continue;
      }
      declarations.push({ kind: 'type', name: statement.name.text, containerPath, node: statement });
    } else if (ts.isEnumDeclaration(statement)) {
      if (!isExported(statement, statement.name.text, exportListNames)) {
        continue;
      }
      declarations.push({ kind: 'enum', name: statement.name.text, containerPath, node: statement });
    } else if (ts.isVariableStatement(statement)) {
      const statementExported = hasExportModifier(statement);
      const list = statement.declarationList.declarations;
      for (const declaration of list) {
        if (!ts.isIdentifier(declaration.name)) {
          continue;
        }
        const name = declaration.name.text;
        if (!statementExported && !exportListNames.has(name)) {
          continue;
        }
        // Single-declaration statements (the common case) hash the whole statement so the
        // const/let keyword participates; multi-declaration statements fall back per declaration.
        declarations.push({
          kind: 'variable',
          name,
          containerPath,
          node: list.length === 1 ? statement : declaration,
          variable: declaration
        });
      }
    }
  }
  return declarations;
};
