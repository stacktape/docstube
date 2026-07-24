import ts from 'typescript';
import { contentHash } from '@docstube/contracts';
import type { BlockEntity, Finding } from '@docstube/contracts';
import type { PageArtifact, VerifierDefinition } from '@docstube/plugin-sdk';
import { runVerifier, walkPageBlocks } from './run-support.ts';

const verifierId = 'code-typecheck-ts';

const matchedLanguages = ['ts', 'tsx', 'typescript'];

// Snippets legitimately import the documented package, which is not installed in the environment
// running verification — unresolved-module diagnostics are noise, not evidence of a bad snippet.
// 2307 = "Cannot find module", 2792 = "Cannot find module … did you mean to set moduleResolution".
const skippedDiagnosticCodes = new Set([2307, 2792]);

export type MdxCodeBlock = { lang: string; code: string; line: number; meta: string };

// Fenced code blocks with their info-string language, the rest of the info string ("meta", e.g.
// `title="run" no-exec`), and the 1-based line of the opening fence.
export const findCodeBlocks = (mdx: string): MdxCodeBlock[] => {
  const lines = mdx.split(/\r?\n/u);
  const blocks: MdxCodeBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const opening = /^ {0,3}(`{3,})([^`]*)$/u.exec(lines[index] ?? '');
    if (!opening) {
      index += 1;
      continue;
    }
    const fenceLength = opening[1]?.length ?? 3;
    const info = (opening[2] ?? '').trim();
    const lang = info.split(/\s+/u)[0] ?? '';
    const meta = info.slice(lang.length).trim();
    const codeLines: string[] = [];
    let cursor = index + 1;
    while (cursor < lines.length) {
      const closing = /^ {0,3}(`{3,})\s*$/u.exec(lines[cursor] ?? '');
      if (closing && (closing[1]?.length ?? 0) >= fenceLength) {
        break;
      }
      codeLines.push(lines[cursor] ?? '');
      cursor += 1;
    }
    blocks.push({ lang, code: codeLines.join('\n'), line: index + 1, meta });
    index = cursor + 1;
  }
  return blocks;
};

// Fences addressable by the contentHash their block entity carries. Tolerates extractors that
// hash with or without a trailing newline; the first fence with a given hash wins.
export const mapFencesByHash = (mdx: string): Map<string, MdxCodeBlock> => {
  const fences = new Map<string, MdxCodeBlock>();
  for (const fence of findCodeBlocks(mdx)) {
    for (const hash of [contentHash(fence.code), contentHash(`${fence.code}\n`)]) {
      if (!fences.has(hash)) {
        fences.set(hash, fence);
      }
    }
  }
  return fences;
};

const typecheckSnippet = (code: string, useTsx: boolean): ts.Diagnostic[] => {
  const fileName = useTsx ? 'snippet.tsx' : 'snippet.ts';
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    // dom included for console/fetch/timers — ubiquitous in docs snippets (live-verified gap).
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.Preserve,
    strict: false,
    noEmit: true,
    skipLibCheck: true,
    types: []
  };
  const sourceFile = ts.createSourceFile(
    fileName,
    code,
    ts.ScriptTarget.ES2022,
    true,
    useTsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  // Virtual host: the snippet lives in memory; lib files fall through to the default host.
  const defaultHost = ts.createCompilerHost(compilerOptions);
  const host: ts.CompilerHost = {
    ...defaultHost,
    getSourceFile: (name, languageVersion, onError, shouldCreateNewSourceFile) =>
      name === fileName
        ? sourceFile
        : defaultHost.getSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile),
    fileExists: (name) => name === fileName || defaultHost.fileExists(name),
    readFile: (name) => (name === fileName ? code : defaultHost.readFile(name)),
    writeFile: () => {}
  };
  const program = ts.createProgram([fileName], compilerOptions, host);
  return [...program.getSyntacticDiagnostics(sourceFile), ...program.getSemanticDiagnostics(sourceFile)].filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error && !skippedDiagnosticCodes.has(diagnostic.code)
  );
};

const diagnosticFinding = (
  artifact: PageArtifact,
  block: BlockEntity,
  fence: MdxCodeBlock,
  diagnostic: ts.Diagnostic
): Finding => {
  const position =
    diagnostic.file && diagnostic.start !== undefined
      ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
      : undefined;
  const snippetLine = position === undefined ? undefined : position.line + 1;
  const mdxLine = snippetLine === undefined ? fence.line : fence.line + snippetLine;
  return {
    source: 'verifier',
    check: verifierId,
    severity: 'error',
    message: `TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}${
      snippetLine === undefined ? '' : ` (snippet line ${snippetLine})`
    }`,
    entity: { version: artifact.version, locale: artifact.locale, pageId: artifact.page.id, entityId: block.id },
    file: artifact.mdxPath,
    span: [mdxLine, mdxLine],
    data: { tsCode: diagnostic.code }
  };
};

export const codeTypecheckTsVerifier: VerifierDefinition = {
  id: verifierId,
  title: 'TypeScript snippets typecheck',
  description:
    'Every TypeScript code-example block must typecheck in isolation (lib es2022, strict off, module resolution ignored). A pass is compile-level proof for the block and its code-sample claims.',
  scope: 'block',
  appliesTo: { blockTypes: ['code-example'], languages: matchedLanguages },
  localeScope: 'source-only',
  proves: true,
  verify: (_ctx, pages) =>
    runVerifier(verifierId, async () => {
      const findings: Finding[] = [];
      const coveredEntityIds: string[] = [];

      for (const artifact of pages) {
        const fencesByHash = mapFencesByHash(artifact.mdx);

        for (const { block } of walkPageBlocks(artifact.page)) {
          if (block.blockType !== 'code-example' || !matchedLanguages.includes((block.language ?? '').toLowerCase())) {
            continue;
          }
          const fence = fencesByHash.get(block.contentHash);
          if (!fence) {
            findings.push({
              source: 'verifier',
              check: verifierId,
              severity: 'warning',
              message: `code-example block ${block.id} has no fenced code block in the MDX matching its contentHash — snippet not verified`,
              entity: {
                version: artifact.version,
                locale: artifact.locale,
                pageId: artifact.page.id,
                entityId: block.id
              },
              file: artifact.mdxPath
            });
            continue;
          }
          const diagnostics = typecheckSnippet(fence.code, (block.language ?? '').toLowerCase() === 'tsx');
          if (diagnostics.length === 0) {
            coveredEntityIds.push(block.id);
            continue;
          }
          for (const diagnostic of diagnostics) {
            findings.push(diagnosticFinding(artifact, block, fence, diagnostic));
          }
        }
      }

      return { findings, coveredEntityIds };
    })
};
