import { readdir, readFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { buildSourceMap } from '@docstube/codemap';
import {
  apiReferenceSymbolSchema,
  extractPythonApiReferencesWithGriffe,
  extractTypeScriptApiReferences
} from '@docstube/extractors';
import { stableThemeComponentNames } from '@docstube/theme';
import type { CodemapLanguage, CodemapSymbol, CodemapSymbolKind } from '@docstube/codemap';
import type { DocstubeConfig, Glossary, ProvenanceCitation, RelativePath, Sha256 } from '@docstube/contracts';
import type { ApiReferenceSymbol, ApiReferenceSymbolKind } from '@docstube/extractors';
import type { ScheduledPage } from './pipeline-run.ts';
import { docstubeDirPath } from './project-workspace.ts';
import type { ProjectSourceFile } from './project-workspace.ts';

export type PageGenerationSourceSymbol = {
  endLine: number;
  kind: CodemapSymbolKind;
  name: string;
  signature?: string;
  startLine: number;
};

export type PageGenerationSource = {
  hash: Sha256;
  language: CodemapLanguage;
  path: RelativePath;
  symbols: readonly PageGenerationSourceSymbol[];
};

export type PageGenerationGlossaryTerm = {
  aliases: readonly string[];
  definition: string;
  id: string;
  term: string;
};

export type PageGenerationContext = {
  apiSymbols: readonly ApiReferenceSymbol[];
  componentNames: readonly string[];
  criteria: readonly string[];
  glossaryTerms: readonly PageGenerationGlossaryTerm[];
  instructions: readonly string[];
  provenance: {
    citations: readonly ProvenanceCitation[];
    reads: readonly RelativePath[];
  };
  sourceDigests: readonly { algorithm: 'sha256'; path: RelativePath; value: Sha256 }[];
  sourceFacts: readonly string[];
  sources: readonly PageGenerationSource[];
};

export type SourceGroundingContext = Pick<
  PageGenerationContext,
  'apiSymbols' | 'provenance' | 'sourceDigests' | 'sourceFacts' | 'sources'
>;

const markdownFilePattern = /\.md$/iu;

const guidanceDirectoryFiles = async (directory: string): Promise<string[]> => {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && markdownFilePattern.test(entry.name))
      .toSorted((left, right) => left.name.localeCompare(right.name))
      .map(async (entry) => {
        const content = await readFile(join(directory, entry.name), 'utf8');
        return [`# ${basename(entry.name, '.md')}`, content.trim()].filter(Boolean).join('\n\n');
      })
  );

  return files.filter((file) => file.length > 0);
};

const readCommittedGuidance = async (
  workspaceDir: string
): Promise<Pick<PageGenerationContext, 'criteria' | 'instructions'>> => {
  const docstubeDir = docstubeDirPath(workspaceDir);
  const [criteria, instructions] = await Promise.all([
    guidanceDirectoryFiles(join(docstubeDir, 'criteria')),
    guidanceDirectoryFiles(join(docstubeDir, 'instructions'))
  ]);

  return { criteria, instructions };
};

const componentNamesForConfig = (config: DocstubeConfig): readonly string[] =>
  [...(config.theme?.components ?? stableThemeComponentNames)].toSorted((left, right) => left.localeCompare(right));

const sourceSymbolFromCodemap = (symbol: CodemapSymbol): PageGenerationSourceSymbol => ({
  name: symbol.name,
  kind: symbol.kind,
  signature: symbol.signature,
  startLine: symbol.range.startLine,
  endLine: symbol.range.endLine
});

const apiKindFromSymbol = (kind: CodemapSymbolKind): ApiReferenceSymbolKind | null => {
  if (kind === 'file') {
    return null;
  }
  if (kind === 'const') {
    return 'variable';
  }
  return kind;
};

const apiExtractorFromLanguage = (language: CodemapLanguage): ApiReferenceSymbol['extractor'] =>
  language === 'python' ? 'griffe' : 'typedoc';

const apiSymbolFromCodemap = (symbol: CodemapSymbol): ApiReferenceSymbol | null => {
  const kind = apiKindFromSymbol(symbol.kind);
  if (!kind) {
    return null;
  }

  return apiReferenceSymbolSchema.parse({
    id: `${apiExtractorFromLanguage(symbol.language)}:${symbol.filePath}:${symbol.name}`,
    name: symbol.name,
    kind,
    sourcePath: symbol.filePath,
    line: symbol.range.startLine,
    extractor: apiExtractorFromLanguage(symbol.language),
    source: 'mock',
    summary: symbol.signature
  });
};

const sourceFactForFile = (source: PageGenerationSource): string => {
  const symbols = source.symbols
    .filter((symbol) => symbol.name !== '<file>')
    .slice(0, 8)
    .map((symbol) =>
      symbol.signature
        ? `${symbol.name} (${symbol.kind}, lines ${symbol.startLine}-${symbol.endLine}, ${symbol.signature})`
        : `${symbol.name} (${symbol.kind}, lines ${symbol.startLine}-${symbol.endLine})`
    );

  const symbolText = symbols.length > 0 ? symbols.join('; ') : 'no named symbols detected';
  return `${source.path} [${source.language}, ${source.hash.slice(0, 12)}]: ${symbolText}`;
};

const glossaryTermsForContext = (glossary: Glossary): PageGenerationGlossaryTerm[] =>
  glossary.terms
    .map((term) => ({
      id: term.id,
      term: term.term,
      definition: term.definition,
      aliases: [...(term.aliases ?? [])].toSorted((left, right) => left.localeCompare(right))
    }))
    .toSorted((left, right) => left.id.localeCompare(right.id));

const provenanceCitationsForSources = (sources: readonly PageGenerationSource[]): ProvenanceCitation[] =>
  sources.flatMap((source) => {
    const symbols = source.symbols.filter((symbol) => symbol.name !== '<file>');
    if (symbols.length === 0) {
      return [{ path: source.path }];
    }

    return symbols.map((symbol) => ({ path: source.path, symbol: symbol.name }));
  });

const typedocExtensions = new Set(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx']);

const apiSymbolKey = (symbol: ApiReferenceSymbol): string => `${symbol.sourcePath}:${symbol.name}`;

const pythonModuleName = (path: RelativePath): string => {
  const fileName = basename(path);
  if (fileName === '__init__.py') {
    return basename(dirname(path));
  }
  return basename(path, '.py');
};

const extractApiSymbolsWithTools = async (input: {
  fallbackSymbols: readonly ApiReferenceSymbol[];
  sources: readonly ProjectSourceFile[];
  workspaceDir: string;
}): Promise<ApiReferenceSymbol[]> => {
  const extracted: ApiReferenceSymbol[] = [];
  const typedocEntryPoints = input.sources
    .filter((source) => typedocExtensions.has(extname(source.path).toLowerCase()))
    .map((source) => join(input.workspaceDir, source.path));

  if (typedocEntryPoints.length > 0) {
    try {
      const result = await extractTypeScriptApiReferences({
        cwd: input.workspaceDir,
        entryPoints: typedocEntryPoints
      });
      if (result.status === 'completed') {
        extracted.push(...result.symbols);
      }
    } catch {
      // TypeDoc can fail on partial workspaces; codemap fallback still keeps source grounding.
    }
  }

  const pythonResults = await Promise.all(
    input.sources
      .filter((candidate) => extname(candidate.path).toLowerCase() === '.py')
      .map((source) =>
        extractPythonApiReferencesWithGriffe({
          moduleName: pythonModuleName(source.path),
          searchPath: join(input.workspaceDir, dirname(source.path))
        })
      )
  );
  for (const result of pythonResults) {
    if (result.status === 'completed') {
      extracted.push(...result.symbols);
    }
  }

  const extractedKeys = new Set(extracted.map(apiSymbolKey));
  const missingFallbacks = input.fallbackSymbols.filter((symbol) => !extractedKeys.has(apiSymbolKey(symbol)));
  return [...extracted, ...missingFallbacks].toSorted((left, right) => left.id.localeCompare(right.id));
};

export const createSourceGroundingContext = (sourcesInput: readonly ProjectSourceFile[]): SourceGroundingContext => {
  const sourceMap = buildSourceMap(sourcesInput.map((source) => ({ path: source.path, content: source.content })));
  const fileMapsByPath = new Map(sourceMap.files.map((file) => [file.path, file]));
  const sources = sourcesInput.map((source): PageGenerationSource => {
    const fileMap = fileMapsByPath.get(source.path);
    return {
      path: source.path,
      hash: source.hash,
      language: fileMap?.language ?? 'unknown',
      symbols: (fileMap?.symbols ?? [])
        .map(sourceSymbolFromCodemap)
        .toSorted((left, right) => `${left.name}:${left.startLine}`.localeCompare(`${right.name}:${right.startLine}`))
    };
  });
  const apiSymbols = sourceMap.symbols
    .map(apiSymbolFromCodemap)
    .filter((symbol): symbol is ApiReferenceSymbol => symbol !== null)
    .toSorted((left, right) => left.id.localeCompare(right.id));

  return {
    apiSymbols,
    provenance: {
      reads: sources.map((source) => source.path),
      citations: provenanceCitationsForSources(sources)
    },
    sourceDigests: sources.map((source) => ({ algorithm: 'sha256', path: source.path, value: source.hash })),
    sourceFacts: sources.map(sourceFactForFile),
    sources
  };
};

export const createPageGenerationContext = async (input: {
  config: DocstubeConfig;
  glossary: Glossary;
  page: ScheduledPage;
  sources: readonly ProjectSourceFile[];
  workspaceDir: string;
}): Promise<PageGenerationContext> => {
  const sourceGrounding = createSourceGroundingContext(input.sources);
  const guidance = await readCommittedGuidance(input.workspaceDir);
  const apiSymbols = await extractApiSymbolsWithTools({
    fallbackSymbols: sourceGrounding.apiSymbols,
    sources: input.sources,
    workspaceDir: input.workspaceDir
  });

  return {
    ...sourceGrounding,
    apiSymbols,
    componentNames: componentNamesForConfig(input.config),
    criteria: guidance.criteria,
    glossaryTerms: glossaryTermsForContext(input.glossary),
    instructions: guidance.instructions
  };
};
