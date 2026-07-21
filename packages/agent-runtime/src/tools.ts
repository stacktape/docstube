import { glob as fsGlob, open, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { contentHash } from '@docstube/contracts';
import type { ObservedRead, TaskResult, ToolDescriptor } from '@docstube/contracts';
import { ToolPolicyError } from './errors.ts';

// The standard read-only tool surface (ARCHITECTURE.md §8.1). Handlers execute in the harness
// process, so observed-reads provenance is a side effect of architecture, not agent cooperation:
// every successful read_file records { file, contentHash } into the per-task collector.

const READ_FILE_MAX_CHARS = 200_000;
// Same policy as GREP_MAX_FILE_BYTES: read_file never loads more than this into memory.
const READ_FILE_MAX_BYTES = 1_000_000;
const GLOB_MAX_MATCHES = 500;
const GREP_MAX_MATCHES = 200;
const GREP_MAX_FILE_BYTES = 1_000_000;
const GREP_MAX_LINE_CHARS = 400;
const GREP_MAX_CONTEXT_LINES = 5;
const SKIPPED_DIR_SEGMENTS = new Set(['node_modules', '.git', 'dist', 'coverage']);

export type ObservedReadsCollector = {
  record: (read: ObservedRead) => void;
  list: () => ObservedRead[];
};

export const createObservedReadsCollector = (onRecord?: (read: ObservedRead) => void): ObservedReadsCollector => {
  const seen = new Map<string, ObservedRead>();
  return {
    record: (read) => {
      const key = `${read.file}\n${read.contentHash}`;
      if (!seen.has(key)) {
        seen.set(key, read);
        onRecord?.(read);
      }
    },
    list: () => [...seen.values()]
  };
};

export type ToolImplementation = {
  descriptor: ToolDescriptor;
  handler: (args: unknown) => Promise<unknown>;
  // Result-bearing tools (submit_page): the harness asks these for the task result when the spec
  // declares a tool-delivered output type ('mdx-ledger') instead of reading the final text.
  taskResult?: (() => TaskResult | undefined) | undefined;
};

export type StandardToolsOptions = {
  repoRoot: string;
  readRoots: readonly string[];
  observedReads: ObservedReadsCollector;
};

const toPosix = (path: string): string => path.split(sep).join('/');

const comparable = (path: string): string => (process.platform === 'win32' ? path.toLowerCase() : path);

const assertRepoRelative = (tool: string, rawPath: string): void => {
  if (rawPath.includes('\\') || isAbsolute(rawPath) || /^[A-Za-z]:/.test(rawPath)) {
    throw new ToolPolicyError({ tool, message: `path must be repo-relative POSIX, got "${rawPath}"` });
  }
};

const isWithin = (target: string, root: string): boolean =>
  target === root || target.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);

// Real path of `absPath` with symlinks resolved. When the path (or a suffix of it) does not exist
// yet, the nearest existing ancestor is resolved and the missing tail re-appended lexically.
const realResolve = async (absPath: string): Promise<string> => {
  let current = absPath;
  const tail: string[] = [];
  for (;;) {
    try {
      const real = await realpath(current);
      return tail.length === 0 ? real : join(real, ...tail.toReversed());
    } catch {
      const parent = dirname(current);
      if (parent === current) {
        return absPath;
      }
      tail.push(basename(current));
      current = parent;
    }
  }
};

// Resolves a repo-relative POSIX path and enforces workspace.readRoots — rejects absolute paths,
// backslashes, and any resolution (including ".." traversal) that escapes every declared root.
// Containment is checked both lexically and on real paths: a symlink inside a read root that
// points outside every root is rejected even though its lexical path looks contained.
const resolveReadPath = async (
  tool: string,
  options: StandardToolsOptions,
  rawPath: string
): Promise<{ absPath: string; repoRelative: string }> => {
  assertRepoRelative(tool, rawPath);
  const absPath = resolve(options.repoRoot, rawPath);
  const fromRepoRoot = relative(options.repoRoot, absPath);
  if (fromRepoRoot.startsWith('..') || isAbsolute(fromRepoRoot)) {
    throw new ToolPolicyError({ tool, message: `path "${rawPath}" escapes the repository root` });
  }
  const rootsAbs = options.readRoots.map((root) => resolve(options.repoRoot, root));
  const allowed = rootsAbs.some((rootAbs) => isWithin(comparable(absPath), comparable(rootAbs)));
  if (!allowed) {
    throw new ToolPolicyError({
      tool,
      message: `path "${rawPath}" is outside the declared read roots [${options.readRoots.join(', ')}]`
    });
  }
  // Roots are realpath'd too so a repo root that itself sits behind a symlink (macOS /tmp) still
  // contains its own files.
  const realTarget = comparable(await realResolve(absPath));
  const realRoots = await Promise.all(rootsAbs.map((rootAbs) => realResolve(rootAbs)));
  if (!realRoots.some((realRoot) => isWithin(realTarget, comparable(realRoot)))) {
    throw new ToolPolicyError({
      tool,
      message: `path "${rawPath}" resolves outside the declared read roots (symlink escape)`
    });
  }
  return { absPath, repoRelative: toPosix(fromRepoRoot) };
};

const parseArgs = <Schema extends z.ZodType>(schema: Schema, tool: string, args: unknown): z.output<Schema> => {
  const parsed = schema.safeParse(args ?? {});
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new ToolPolicyError({ tool, message: `invalid arguments: ${detail}` });
  }
  return parsed.data;
};

const isSkippedPath = (posixPath: string): boolean =>
  posixPath.split('/').some((segment) => SKIPPED_DIR_SEGMENTS.has(segment));

const readFileParamsSchema = z.object({
  path: z.string().min(1),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional()
});

const readFileDescriptor: ToolDescriptor = {
  name: 'read_file',
  description: 'Read a repo-relative text file, optionally limited to an inclusive 1-based line range.',
  paramsJsonSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Repo-relative POSIX path of the file to read.' },
      startLine: { type: 'integer', minimum: 1, description: 'First line to return (1-based, inclusive).' },
      endLine: { type: 'integer', minimum: 1, description: 'Last line to return (1-based, inclusive).' }
    },
    required: ['path']
  }
};

const listDirParamsSchema = z.object({ path: z.string().min(1).default('.') });

const listDirDescriptor: ToolDescriptor = {
  name: 'list_dir',
  description: 'List the entries of a repo-relative directory.',
  paramsJsonSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Repo-relative POSIX directory path. Defaults to the repo root.' }
    }
  }
};

const globParamsSchema = z.object({
  pattern: z.string().min(1),
  path: z.string().min(1).default('.')
});

const globDescriptor: ToolDescriptor = {
  name: 'glob',
  description: 'Find files matching a glob pattern (e.g. "src/**/*.ts") under a repo-relative directory.',
  paramsJsonSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern relative to the search directory.' },
      path: { type: 'string', description: 'Repo-relative directory to search in. Defaults to the repo root.' }
    },
    required: ['pattern']
  }
};

type GrepMatch = {
  file: string;
  line: number;
  text: string;
  before?: string[];
  after?: string[];
};

const grepParamsSchema = z.object({
  pattern: z.string().min(1),
  path: z.string().min(1).default('.'),
  glob: z.string().min(1).optional(),
  ignoreCase: z.boolean().default(false),
  contextLines: z.number().int().min(0).max(GREP_MAX_CONTEXT_LINES).default(0),
  maxMatches: z.number().int().positive().max(GREP_MAX_MATCHES).default(100)
});

const grepDescriptor: ToolDescriptor = {
  name: 'grep',
  description:
    'Search file contents with a JavaScript regular expression; returns matching lines with locations. ' +
    'Supports case-insensitive matching (ignoreCase), filtering scanned files by glob, and surrounding context lines.',
  paramsJsonSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'JavaScript regular expression to search for.' },
      path: { type: 'string', description: 'Repo-relative directory to search in. Defaults to the repo root.' },
      glob: {
        type: 'string',
        description: 'Glob pattern (e.g. "**/*.ts") relative to the search directory; only matching files are scanned.'
      },
      ignoreCase: { type: 'boolean', description: 'Match case-insensitively (regex "i" flag). Defaults to false.' },
      contextLines: {
        type: 'integer',
        minimum: 0,
        maximum: GREP_MAX_CONTEXT_LINES,
        description: 'Lines of context to return before and after each match (0-5). Defaults to 0.'
      },
      maxMatches: { type: 'integer', minimum: 1, maximum: GREP_MAX_MATCHES, description: 'Cap on returned matches.' }
    },
    required: ['pattern']
  }
};

export const standardToolDescriptors = (): ToolDescriptor[] => [
  readFileDescriptor,
  listDirDescriptor,
  globDescriptor,
  grepDescriptor
];

export const createStandardTools = (options: StandardToolsOptions): ToolImplementation[] => {
  const readFileTool: ToolImplementation = {
    descriptor: readFileDescriptor,
    handler: async (args) => {
      const params = parseArgs(readFileParamsSchema, 'read_file', args);
      const { absPath, repoRelative } = await resolveReadPath('read_file', options, params.path);
      // Stat before reading so a multi-gigabyte file never lands in memory; oversized files get a
      // bounded prefix. No observed read is recorded for a partial read: staleness checks compare
      // against the FULL file hash, and a prefix hash would mark the page permanently stale.
      const stats = await stat(absPath);
      if (stats.size > READ_FILE_MAX_BYTES) {
        const handle = await open(absPath, 'r');
        let prefix: string;
        try {
          const buffer = Buffer.alloc(READ_FILE_MAX_BYTES);
          const { bytesRead } = await handle.read(buffer, 0, READ_FILE_MAX_BYTES, 0);
          prefix = buffer.subarray(0, bytesRead).toString('utf8');
        } finally {
          await handle.close();
        }
        const lines = prefix.split(/\r?\n/);
        const startLine = Math.min(params.startLine ?? 1, lines.length);
        const endLine = Math.min(params.endLine ?? lines.length, lines.length);
        const content = lines
          .slice(startLine - 1, endLine)
          .join('\n')
          .slice(0, READ_FILE_MAX_CHARS);
        return {
          path: repoRelative,
          content,
          startLine,
          endLine,
          truncated: true,
          note: `file too large (${stats.size} bytes), showing the first ${READ_FILE_MAX_BYTES} bytes only`
        };
      }
      const raw = await readFile(absPath, 'utf8');
      options.observedReads.record({ file: repoRelative, contentHash: contentHash(raw) });
      const lines = raw.split(/\r?\n/);
      const startLine = Math.min(params.startLine ?? 1, lines.length);
      const endLine = Math.min(params.endLine ?? lines.length, lines.length);
      let content = lines.slice(startLine - 1, endLine).join('\n');
      let truncated = false;
      if (content.length > READ_FILE_MAX_CHARS) {
        content = content.slice(0, READ_FILE_MAX_CHARS);
        truncated = true;
      }
      return { path: repoRelative, content, startLine, endLine, totalLines: lines.length, truncated };
    }
  };

  const listDirTool: ToolImplementation = {
    descriptor: listDirDescriptor,
    handler: async (args) => {
      const params = parseArgs(listDirParamsSchema, 'list_dir', args);
      const { absPath } = await resolveReadPath('list_dir', options, params.path);
      const dirents = await readdir(absPath, { withFileTypes: true });
      const entries = dirents
        .map((entry) => ({ name: entry.name, type: entry.isDirectory() ? ('dir' as const) : ('file' as const) }))
        .toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      return { path: params.path, entries };
    }
  };

  const globTool: ToolImplementation = {
    descriptor: globDescriptor,
    handler: async (args) => {
      const params = parseArgs(globParamsSchema, 'glob', args);
      assertRepoRelative('glob', params.pattern);
      if (params.pattern.split('/').includes('..')) {
        throw new ToolPolicyError({ tool: 'glob', message: 'glob patterns must not contain ".." segments' });
      }
      const { absPath } = await resolveReadPath('glob', options, params.path);
      const rootRelative = relative(options.repoRoot, absPath);
      const matches: string[] = [];
      let truncated = false;
      for await (const match of fsGlob(params.pattern, {
        cwd: absPath,
        exclude: ['**/node_modules/**', '**/.git/**']
      })) {
        if (matches.length >= GLOB_MAX_MATCHES) {
          truncated = true;
          break;
        }
        matches.push(toPosix(rootRelative === '' ? match : join(rootRelative, match)));
      }
      matches.sort();
      return { pattern: params.pattern, matches, truncated };
    }
  };

  const grepTool: ToolImplementation = {
    descriptor: grepDescriptor,
    handler: async (args) => {
      const params = parseArgs(grepParamsSchema, 'grep', args);
      let regex: RegExp;
      try {
        regex = new RegExp(params.pattern, params.ignoreCase ? 'i' : '');
      } catch (error) {
        throw new ToolPolicyError({
          tool: 'grep',
          message: `invalid regular expression: ${error instanceof Error ? error.message : String(error)}`
        });
      }
      const { absPath } = await resolveReadPath('grep', options, params.path);
      const dirents = await readdir(absPath, { recursive: true, withFileTypes: true });
      const matches: GrepMatch[] = [];
      let truncated = false;
      let filesScanned = 0;
      const truncateLine = (line: string): string => line.slice(0, GREP_MAX_LINE_CHARS);
      for (const entry of dirents) {
        if (!entry.isFile()) {
          continue;
        }
        const fileAbs = join(entry.parentPath, entry.name);
        const repoRelative = toPosix(relative(options.repoRoot, fileAbs));
        if (isSkippedPath(repoRelative)) {
          continue;
        }
        // Same matcher family as the glob tool: node's minimatch-backed glob semantics, applied to
        // the path relative to the search directory (matching how glob patterns are anchored).
        if (params.glob !== undefined && !posix.matchesGlob(toPosix(relative(absPath, fileAbs)), params.glob)) {
          continue;
        }
        let text: string;
        try {
          text = await readFile(fileAbs, 'utf8');
        } catch {
          continue;
        }
        if (text.length > GREP_MAX_FILE_BYTES || text.includes('\u0000')) {
          continue;
        }
        filesScanned += 1;
        const lines = text.split(/\r?\n/);
        const fileMatchesBefore = matches.length;
        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index] ?? '';
          if (!regex.test(line)) {
            continue;
          }
          if (matches.length >= params.maxMatches) {
            truncated = true;
            break;
          }
          const match: GrepMatch = { file: repoRelative, line: index + 1, text: truncateLine(line) };
          if (params.contextLines > 0) {
            match.before = lines.slice(Math.max(0, index - params.contextLines), index).map(truncateLine);
            match.after = lines.slice(index + 1, index + 1 + params.contextLines).map(truncateLine);
          }
          matches.push(match);
        }
        // A returned match exposes this file's content to the agent, so it enters provenance exactly
        // like a full read_file (the full content is already in memory here). Files scanned without
        // a returned match are NOT observed reads.
        if (matches.length > fileMatchesBefore) {
          options.observedReads.record({ file: repoRelative, contentHash: contentHash(text) });
        }
        if (truncated) {
          break;
        }
      }
      return { pattern: params.pattern, matches, truncated, filesScanned };
    }
  };

  return [readFileTool, listDirTool, globTool, grepTool];
};
