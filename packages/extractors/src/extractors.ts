import { execFile } from 'node:child_process';
import { relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { Application, EntryPointStrategy, LogLevel, ReflectionKind } from 'typedoc';
import type { DeclarationReflection, Reflection } from 'typedoc';
import { z } from 'zod';
import { relativePathSchema } from '@docstube/contracts';
import type { RelativePath } from '@docstube/contracts';

const execFileAsync = promisify(execFile);

export const builtInApiExtractorIds = ['typedoc', 'griffe'] as const;

export type ApiExtractorId = (typeof builtInApiExtractorIds)[number];

export const apiReferenceSymbolKinds = [
  'class',
  'function',
  'interface',
  'method',
  'property',
  'type',
  'variable'
] as const;

export type ApiReferenceSymbolKind = (typeof apiReferenceSymbolKinds)[number];

export const apiReferenceSymbolSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(apiReferenceSymbolKinds),
  sourcePath: relativePathSchema,
  line: z.int().positive().optional(),
  extractor: z.enum(builtInApiExtractorIds),
  source: z.enum(['griffe', 'mock', 'typedoc']),
  summary: z.string().optional()
});

export type ApiReferenceSymbol = z.infer<typeof apiReferenceSymbolSchema>;

export type ApiExtractionResult =
  | {
      status: 'completed';
      extractor: ApiExtractorId;
      source: 'griffe' | 'mock' | 'typedoc';
      symbols: ApiReferenceSymbol[];
    }
  | {
      status: 'skipped';
      extractor: ApiExtractorId;
      reason: string;
    };

export type TypeDocExtractionOptions = {
  entryPoints: readonly string[];
  cwd?: string;
  tsconfig?: string;
};

export type GriffeExtractionOptions = {
  moduleName: string;
  searchPath: string;
  pythonCommand?: string;
  mockSymbolsWhenUnavailable?: ApiReferenceSymbol[];
};

const toPosixPath = (path: string): RelativePath => relativePathSchema.parse(path.replaceAll('\\', '/'));

const toTypeDocPath = (path: string): string => path.replaceAll('\\', '/');

const relativeSourcePath = (cwd: string, fileName: string): RelativePath => {
  const absolute = resolve(fileName);
  const relativePath = relative(resolve(cwd), absolute);
  return toPosixPath(relativePath.startsWith('..') ? fileName : relativePath);
};

const typedocKind = (reflection: Reflection): ApiReferenceSymbolKind | null => {
  if (reflection.kindOf(ReflectionKind.Class)) {
    return 'class';
  }
  if (reflection.kindOf(ReflectionKind.Function)) {
    return 'function';
  }
  if (reflection.kindOf(ReflectionKind.Interface)) {
    return 'interface';
  }
  if (reflection.kindOf(ReflectionKind.Method)) {
    return 'method';
  }
  if (reflection.kindOf(ReflectionKind.Property)) {
    return 'property';
  }
  if (reflection.kindOf(ReflectionKind.TypeAlias)) {
    return 'type';
  }
  if (reflection.kindOf(ReflectionKind.Variable)) {
    return 'variable';
  }
  return null;
};

const commentSummary = (reflection: Reflection): string | undefined => {
  const text = reflection.comment?.summary
    .map((part) => part.text)
    .join('')
    .trim();
  return text || undefined;
};

const sourceForDeclaration = (reflection: DeclarationReflection): { fileName: string; line?: number } | null => {
  const source = reflection.sources?.[0];
  if (!source) {
    return null;
  }
  return { fileName: source.fullFileName || source.fileName, line: source.line };
};

const typedocSymbol = (cwd: string, reflection: DeclarationReflection): ApiReferenceSymbol | null => {
  const kind = typedocKind(reflection);
  const source = sourceForDeclaration(reflection);
  if (!kind || !source) {
    return null;
  }

  const sourcePath = relativeSourcePath(cwd, source.fileName);
  return apiReferenceSymbolSchema.parse({
    id: `typedoc:${sourcePath}:${reflection.getFullName('.')}`,
    name: reflection.name,
    kind,
    sourcePath,
    line: source.line,
    extractor: 'typedoc',
    source: 'typedoc',
    summary: commentSummary(reflection)
  });
};

export const extractTypeScriptApiReferences = async (
  options: TypeDocExtractionOptions
): Promise<ApiExtractionResult> => {
  const cwd = resolve(options.cwd ?? process.cwd());
  const app = await Application.bootstrap(
    {
      entryPoints: options.entryPoints.map(toTypeDocPath),
      entryPointStrategy: EntryPointStrategy.Resolve,
      excludeInternal: true,
      excludePrivate: true,
      logLevel: LogLevel.None,
      skipErrorChecking: true,
      tsconfig: options.tsconfig ? toTypeDocPath(options.tsconfig) : undefined
    },
    []
  );
  const project = await app.convert();

  if (!project) {
    return { status: 'skipped', extractor: 'typedoc', reason: 'TypeDoc did not produce a project reflection' };
  }

  const symbols: ApiReferenceSymbol[] = [];
  project.traverse((reflection) => {
    if (reflection.isDeclaration()) {
      const symbol = typedocSymbol(cwd, reflection);
      if (symbol) {
        symbols.push(symbol);
      }
    }
  });

  return {
    status: 'completed',
    extractor: 'typedoc',
    source: 'typedoc',
    symbols: symbols.toSorted((left, right) => left.id.localeCompare(right.id))
  };
};

const completedMockGriffeResult = (symbols: ApiReferenceSymbol[]): ApiExtractionResult => ({
  status: 'completed',
  extractor: 'griffe',
  source: 'mock',
  symbols: symbols.map((symbol) => apiReferenceSymbolSchema.parse({ ...symbol, extractor: 'griffe', source: 'mock' }))
});

const griffeKind = (value: unknown): ApiReferenceSymbolKind | null => {
  const kind = String(value ?? '').toLowerCase();
  if (kind.includes('class')) {
    return 'class';
  }
  if (kind.includes('function')) {
    return 'function';
  }
  if (kind.includes('attribute') || kind.includes('variable')) {
    return 'variable';
  }
  return null;
};

const numberValue = (value: unknown): number | undefined =>
  typeof value === 'number' && value > 0 ? value : undefined;

const collectGriffeSymbols = (
  value: unknown,
  sourcePath: RelativePath,
  symbols: ApiReferenceSymbol[] = []
): ApiReferenceSymbol[] => {
  if (!value || typeof value !== 'object') {
    return symbols;
  }

  const node = value as Record<string, unknown>;
  const name = typeof node.name === 'string' ? node.name : undefined;
  const kind = griffeKind(node.kind ?? node.type);
  const line =
    numberValue(node.lineno) ??
    numberValue(node.line) ??
    (Array.isArray(node.lines) ? numberValue(node.lines[0]) : undefined);

  if (name && kind) {
    symbols.push(
      apiReferenceSymbolSchema.parse({
        id: `griffe:${sourcePath}:${name}`,
        name,
        kind,
        sourcePath,
        line,
        extractor: 'griffe',
        source: 'griffe'
      })
    );
  }

  for (const key of ['members', 'children']) {
    const children = node[key];
    if (children && typeof children === 'object') {
      const childValues = Array.isArray(children) ? children : Object.values(children);
      for (const child of childValues) {
        collectGriffeSymbols(child, sourcePath, symbols);
      }
    }
  }

  return symbols;
};

export const extractPythonApiReferencesWithGriffe = async (
  options: GriffeExtractionOptions
): Promise<ApiExtractionResult> => {
  const pythonCommand = options.pythonCommand ?? 'python';

  try {
    await execFileAsync(pythonCommand, ['-c', 'import griffe'], { cwd: resolve(options.searchPath) });
  } catch {
    if (options.mockSymbolsWhenUnavailable) {
      return completedMockGriffeResult(options.mockSymbolsWhenUnavailable);
    }
    return { status: 'skipped', extractor: 'griffe', reason: 'Python griffe package is unavailable' };
  }

  try {
    const { stdout } = await execFileAsync(
      pythonCommand,
      ['-m', 'griffe', 'dump', options.moduleName, '--search-path', resolve(options.searchPath), '--format', 'json'],
      {
        cwd: resolve(options.searchPath)
      }
    );
    const sourcePath = toPosixPath(`${options.moduleName.replaceAll('.', '/')}.py`);
    const symbols = collectGriffeSymbols(JSON.parse(stdout), sourcePath).toSorted((left, right) =>
      left.id.localeCompare(right.id)
    );

    if (symbols.length === 0) {
      return { status: 'skipped', extractor: 'griffe', reason: 'griffe produced no parseable API symbols' };
    }

    return {
      status: 'completed',
      extractor: 'griffe',
      source: 'griffe',
      symbols
    };
  } catch (error) {
    return {
      status: 'skipped',
      extractor: 'griffe',
      reason: error instanceof Error ? error.message : 'griffe extraction failed'
    };
  }
};
