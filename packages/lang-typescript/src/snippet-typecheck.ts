import type { Finding } from '@docstube/contracts';
import ts from 'typescript';

const snippetFileName = 'docstube-snippet.ts';
const checkId = 'code-typecheck-ts';

// Module-resolution failures never fail the check: snippets legitimately import the documented
// package, which is usually not installed where docstube runs (CI, a contributor clone, a docs
// preview). 2307 = "Cannot find module", 2792 = the moduleResolution-hint variant of the same.
const ignoredDiagnosticCodes = new Set([2307, 2792]);

// Typechecks a documentation snippet in-memory: real lib files (es2022) from the installed
// TypeScript package, the snippet itself served from a virtual file, no filesystem writes.
export const typecheckSnippet = async (code: string, ctx: { repoRoot: string }): Promise<Finding[]> => {
  const options: ts.CompilerOptions = {
    // dom included for console/fetch/timers — ubiquitous in docs snippets (live-verified gap).
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true,
    noEmit: true,
    skipLibCheck: true,
    strict: false,
    types: []
  };
  const defaultHost = ts.createCompilerHost(options);
  const host: ts.CompilerHost = {
    ...defaultHost,
    // Resolve snippet imports against the documented repo, so installed deps DO typecheck.
    getCurrentDirectory: () => ctx.repoRoot,
    fileExists: (fileName) => fileName === snippetFileName || defaultHost.fileExists(fileName),
    readFile: (fileName) => (fileName === snippetFileName ? code : defaultHost.readFile(fileName)),
    getSourceFile: (fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile) =>
      fileName === snippetFileName
        ? ts.createSourceFile(fileName, code, languageVersionOrOptions, true)
        : defaultHost.getSourceFile(fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile),
    writeFile: () => {}
  };
  const program = ts.createProgram([snippetFileName], options, host);
  const findings: Finding[] = [];
  for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
    if (ignoredDiagnosticCodes.has(diagnostic.code)) {
      continue;
    }
    const severity =
      diagnostic.category === ts.DiagnosticCategory.Error
        ? ('error' as const)
        : diagnostic.category === ts.DiagnosticCategory.Warning
          ? ('warning' as const)
          : undefined;
    if (severity === undefined) {
      continue;
    }
    const finding: Finding = {
      source: 'verifier',
      check: checkId,
      severity,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
      data: { code: diagnostic.code }
    };
    if (diagnostic.file?.fileName === snippetFileName && diagnostic.start !== undefined) {
      const startLine = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1;
      const endLine =
        diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start + (diagnostic.length ?? 0)).line + 1;
      finding.span = [startLine, endLine];
    }
    findings.push(finding);
  }
  return findings;
};
