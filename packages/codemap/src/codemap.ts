import { createHash } from 'node:crypto';
import { z } from 'zod';
import { relativePathSchema, sha256Schema } from '@docstube/contracts';
import type { RelativePath, Sha256 } from '@docstube/contracts';
import type { Language as TreeSitterLanguage } from 'web-tree-sitter';

export const tierOneCodemapLanguages = ['javascript', 'typescript', 'python'] as const;

export type SupportedCodemapLanguage = (typeof tierOneCodemapLanguages)[number];

export const codemapLanguages = [...tierOneCodemapLanguages, 'unknown'] as const;

export type CodemapLanguage = (typeof codemapLanguages)[number];

export const codemapSymbolKinds = ['class', 'const', 'file', 'function', 'interface', 'type', 'variable'] as const;

export type CodemapSymbolKind = (typeof codemapSymbolKinds)[number];

export const sourceRangeSchema = z.strictObject({
  startLine: z.int().positive(),
  endLine: z.int().positive()
});

export type SourceRange = z.infer<typeof sourceRangeSchema>;

export const codemapSymbolSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(codemapSymbolKinds),
  language: z.enum(codemapLanguages),
  filePath: relativePathSchema,
  range: sourceRangeSchema,
  normalizedHash: sha256Schema,
  signature: z.string().optional()
});

export type CodemapSymbol = z.infer<typeof codemapSymbolSchema>;

export const sourceFileMapSchema = z.strictObject({
  path: relativePathSchema,
  language: z.enum(codemapLanguages),
  normalizedHash: sha256Schema,
  symbols: z.array(codemapSymbolSchema)
});

export type SourceFileMap = z.infer<typeof sourceFileMapSchema>;

export const sourceMapArtifactSchema = z.strictObject({
  version: z.literal(1),
  files: z.array(sourceFileMapSchema),
  symbols: z.array(codemapSymbolSchema)
});

export type SourceMapArtifact = z.infer<typeof sourceMapArtifactSchema>;

export type SourceFileInput = {
  path: RelativePath;
  content: string;
};

export type TreeSitterLanguageProvider = () => Promise<TreeSitterLanguage>;

export type CodemapLanguagePlugin = {
  id: SupportedCodemapLanguage;
  extensions: readonly string[];
  treeSitterLanguage?: TreeSitterLanguageProvider;
  parseSymbols: (file: SourceFileInput, language: SupportedCodemapLanguage) => CodemapSymbol[];
};

export type SourceMapDiff = {
  added: string[];
  changed: string[];
  removed: string[];
  unchanged: string[];
};

const lineBreakPattern = /\r?\n/u;

const toPosixPath = (path: string): string => path.replaceAll('\\', '/');

const sha256 = (content: string): Sha256 => sha256Schema.parse(createHash('sha256').update(content).digest('hex'));

const splitSourceLines = (source: string): string[] => {
  const lines = source.split(lineBreakPattern);
  if (lines.length > 1 && lines.at(-1) === '') {
    return lines.slice(0, -1);
  }
  return lines;
};

export const normalizeSourceForHash = (source: string, language: CodemapLanguage): string => {
  const unix = source.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  const withoutBlockComments = unix.replaceAll(/\/\*[\s\S]*?\*\//gu, '');
  const withoutLineComments =
    language === 'python'
      ? withoutBlockComments.replaceAll(/(^|\s)#.*$/gmu, '$1')
      : withoutBlockComments.replaceAll(/(^|\s)\/\/.*$/gmu, '$1');

  return withoutLineComments
    .split(lineBreakPattern)
    .map((line) => line.trim().replaceAll(/\s+/gu, ' '))
    .filter(Boolean)
    .join('\n');
};

export const normalizedSourceHash = (source: string, language: CodemapLanguage): Sha256 =>
  sha256(normalizeSourceForHash(source, language));

export const detectCodemapLanguage = (path: RelativePath): CodemapLanguage => {
  const normalized = toPosixPath(path).toLowerCase();
  if (normalized.endsWith('.ts') || normalized.endsWith('.tsx')) {
    return 'typescript';
  }
  if (
    normalized.endsWith('.js') ||
    normalized.endsWith('.jsx') ||
    normalized.endsWith('.mjs') ||
    normalized.endsWith('.cjs')
  ) {
    return 'javascript';
  }
  if (normalized.endsWith('.py')) {
    return 'python';
  }
  return 'unknown';
};

const symbolId = (language: CodemapLanguage, filePath: RelativePath, name: string): string =>
  `${language}:${filePath}:${name}`;

const rangeContent = (lines: readonly string[], range: SourceRange): string =>
  lines.slice(range.startLine - 1, range.endLine).join('\n');

const findEndLine = (starts: readonly number[], currentIndex: number, lineCount: number): number => {
  const next = starts[currentIndex + 1];
  return next ? next - 1 : lineCount;
};

const makeSymbol = (
  file: SourceFileInput,
  language: SupportedCodemapLanguage,
  name: string,
  kind: CodemapSymbolKind,
  range: SourceRange,
  signature: string | undefined,
  lines: readonly string[]
): CodemapSymbol =>
  codemapSymbolSchema.parse({
    id: symbolId(language, file.path, name),
    name,
    kind,
    language,
    filePath: file.path,
    range,
    normalizedHash: normalizedSourceHash(rangeContent(lines, range), language),
    signature
  });

const tsSymbolPattern =
  /^\s*(?:export\s+)?(?:declare\s+)?(?:(async)\s+)?(function|class|interface|type|const|let|var)\s+([A-Za-z_$][\w$]*)/u;

const tsKind = (keyword: string): CodemapSymbolKind => {
  if (keyword === 'let' || keyword === 'var') {
    return 'variable';
  }
  return keyword as CodemapSymbolKind;
};

const parseTsLikeSymbols = (file: SourceFileInput, language: SupportedCodemapLanguage): CodemapSymbol[] => {
  const lines = splitSourceLines(file.content);
  const matches = lines
    .map((line, index) => ({ line, lineNumber: index + 1, match: tsSymbolPattern.exec(line) }))
    .filter((item): item is { line: string; lineNumber: number; match: RegExpExecArray } => item.match !== null);

  const starts = matches.map((item) => item.lineNumber);
  return matches.map((item, index) => {
    const keyword = item.match[2]!;
    const name = item.match[3]!;
    const range = { startLine: item.lineNumber, endLine: findEndLine(starts, index, lines.length) };
    return makeSymbol(file, language, name, tsKind(keyword), range, item.line.trim(), lines);
  });
};

const pythonSymbolPattern = /^(\s*)(?:(async)\s+)?(def|class)\s+([A-Za-z_]\w*)/u;

const parsePythonSymbols = (file: SourceFileInput, language: SupportedCodemapLanguage): CodemapSymbol[] => {
  const lines = splitSourceLines(file.content);
  const matches = lines
    .map((line, index) => ({ line, lineNumber: index + 1, match: pythonSymbolPattern.exec(line) }))
    .filter((item): item is { line: string; lineNumber: number; match: RegExpExecArray } => item.match !== null)
    .filter((item) => item.match[1]!.length === 0);

  const starts = matches.map((item) => item.lineNumber);
  return matches.map((item, index) => {
    const keyword = item.match[3]!;
    const name = item.match[4]!;
    const range = { startLine: item.lineNumber, endLine: findEndLine(starts, index, lines.length) };
    return makeSymbol(file, language, name, keyword === 'class' ? 'class' : 'function', range, item.line.trim(), lines);
  });
};

export const defaultCodemapLanguagePlugins: readonly CodemapLanguagePlugin[] = [
  {
    id: 'typescript',
    extensions: ['.ts', '.tsx'],
    parseSymbols: parseTsLikeSymbols
  },
  {
    id: 'javascript',
    extensions: ['.js', '.jsx', '.mjs', '.cjs'],
    parseSymbols: parseTsLikeSymbols
  },
  {
    id: 'python',
    extensions: ['.py'],
    parseSymbols: parsePythonSymbols
  }
] as const;

const fallbackFileSymbol = (file: SourceFileInput, language: CodemapLanguage): CodemapSymbol =>
  codemapSymbolSchema.parse({
    id: symbolId(language, file.path, '<file>'),
    name: '<file>',
    kind: 'file',
    language,
    filePath: file.path,
    range: { startLine: 1, endLine: Math.max(1, splitSourceLines(file.content).length) },
    normalizedHash: normalizedSourceHash(file.content, language),
    signature: file.path
  });

export const buildSourceMap = (
  files: readonly SourceFileInput[],
  plugins: readonly CodemapLanguagePlugin[] = defaultCodemapLanguagePlugins
): SourceMapArtifact => {
  const sourceFiles = files
    .map((file) => ({ path: relativePathSchema.parse(toPosixPath(file.path)), content: file.content }))
    .toSorted((left, right) => left.path.localeCompare(right.path));

  const fileMaps = sourceFiles.map((file): SourceFileMap => {
    const language = detectCodemapLanguage(file.path);
    const plugin = language === 'unknown' ? undefined : plugins.find((candidate) => candidate.id === language);
    const parsedSymbols =
      language === 'unknown' || !plugin ? [] : plugin.parseSymbols(file, language as SupportedCodemapLanguage);
    const symbols = parsedSymbols.length > 0 ? parsedSymbols : [fallbackFileSymbol(file, language)];

    return sourceFileMapSchema.parse({
      path: file.path,
      language,
      normalizedHash: normalizedSourceHash(file.content, language),
      symbols: symbols.toSorted((left, right) => left.id.localeCompare(right.id))
    });
  });

  return sourceMapArtifactSchema.parse({
    version: 1,
    files: fileMaps,
    symbols: fileMaps.flatMap((file) => file.symbols).toSorted((left, right) => left.id.localeCompare(right.id))
  });
};

export const diffSourceMaps = (before: SourceMapArtifact, after: SourceMapArtifact): SourceMapDiff => {
  const beforeSymbols = new Map(before.symbols.map((symbol) => [symbol.id, symbol]));
  const afterSymbols = new Map(after.symbols.map((symbol) => [symbol.id, symbol]));

  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];
  const unchanged: string[] = [];

  for (const [id, symbol] of afterSymbols) {
    const previous = beforeSymbols.get(id);
    if (!previous) {
      added.push(id);
    } else if (previous.normalizedHash === symbol.normalizedHash) {
      unchanged.push(id);
    } else {
      changed.push(id);
    }
  }

  for (const id of beforeSymbols.keys()) {
    if (!afterSymbols.has(id)) {
      removed.push(id);
    }
  }

  return {
    added: added.toSorted(),
    changed: changed.toSorted(),
    removed: removed.toSorted(),
    unchanged: unchanged.toSorted()
  };
};

export const serializeSourceMap = (sourceMap: SourceMapArtifact): string => {
  const parsed = sourceMapArtifactSchema.parse(sourceMap);
  return `${JSON.stringify(parsed, null, 2)}\n`;
};
