import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeDeclaration } from '@docstube/codemap';
import type { SymbolRecord } from '@docstube/contracts';
import type { LanguagePackContext } from '@docstube/plugin-sdk';
import { z } from 'zod';
import { pythonInspectorSource } from './python-inspector-source.ts';
import { requirePythonInterpreter, runProcess } from './python-interpreter.ts';

// Python symbol extraction via Python's own `ast` module, run as a subprocess
// (src/python-inspector.py, a stdlib-only script shipped as a package asset). Documenting a
// Python repo implies an interpreter is installed, and CPython's parser is the only one that is
// never wrong about Python syntax — no npm parser dependency needed.
//
// HASHING CHOICE (deliberate difference from the TS pack): the inspector reconstructs
// declarations from the AST as SIGNATURES ONLY — a function/method hashes its decorators +
// def line, a class hashes its class line plus the signatures of __init__ and its public
// methods. The TS pack hashes the whole declaration text including bodies (pessimistic:
// implementation edits regenerate dependents). Here the hash changes when the API shape
// changes and stays stable when bodies change — Python bodies are runtime detail, and the
// AST reconstruction already guarantees comment/docstring/formatting immunity.
//
// The inspector reads files from disk itself (paths on argv, cwd = repoRoot) rather than through
// ctx.readFile: shipping file contents across the process boundary buys nothing here, and codemap
// builds read from the working tree either way.

const langId = 'py';
const signatureMaxLength = 200;
const chunkSize = 50;
const inspectorTimeoutMs = 120_000;

// The inspector produced no usable output — a pack/environment bug, never per-file user data
// (per-file syntax errors come back inside the JSON and are only logged).
export class PythonInspectorError extends Error {
  constructor(detail: string) {
    super(`lang-python inspector failed: ${detail}`);
    this.name = 'PythonInspectorError';
  }
}

const inspectorSymbolSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(['function', 'method', 'class', 'variable']),
  lineno: z.number().int().positive(),
  end_lineno: z.number().int().positive(),
  signature: z.string(),
  declaration: z.string(),
  className: z.string().optional()
});
type InspectorSymbol = z.infer<typeof inspectorSymbolSchema>;

const inspectorFileSchema = z.union([
  z.object({ file: z.string(), symbols: z.array(inspectorSymbolSchema) }),
  z.object({ file: z.string(), error: z.string() })
]);

const inspectorOutputSchema = z.object({ files: z.array(inspectorFileSchema) });

// In source mode the inspector sits next to this module; in the built package it ships at
// src/python-inspector.py relative to dist/ (see package.json "files").
const inspectorCandidates = ['python-inspector.py', '../src/python-inspector.py'];

// pkg snapshots cannot expose a loose .py file to a real python process, so the embedded source
// is materialized once into a content-addressed cache path (write-once: the hash pins the exact
// script version, and a concurrent writer produces identical bytes anyway).
export const materializeEmbeddedInspector = async (): Promise<string> => {
  const hash = createHash('sha256').update(pythonInspectorSource, 'utf8').digest('hex').slice(0, 16);
  const path = join(tmpdir(), `docstube-python-inspector-${hash}.py`);
  if (!existsSync(path)) {
    await writeFile(path, pythonInspectorSource, 'utf8');
  }
  return path;
};

export const resolveInspectorPath = async (): Promise<string> => {
  // Inside a pkg binary the candidates may exist on the VIRTUAL snapshot filesystem, which a real
  // python process cannot read — go straight to the embedded copy there.
  const inPkgSnapshot = (process as { pkg?: unknown }).pkg !== undefined;
  if (!inPkgSnapshot) {
    for (const candidate of inspectorCandidates) {
      const path = fileURLToPath(new URL(candidate, import.meta.url));
      if (existsSync(path)) {
        return path;
      }
    }
  }
  // No readable file asset next to the module: fall back to the embedded copy in the OS temp dir.
  return materializeEmbeddedInspector();
};

const chunksOf = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

// Module segments from the repo-relative path: strip .py, drop a trailing __init__ (the package
// directory IS the module).
const moduleSegments = (repoRelativePath: string): string[] => {
  const segments = repoRelativePath.replace(/\.py$/u, '').split('/');
  return segments.at(-1) === '__init__' ? segments.slice(0, -1) : segments;
};

type HashSymbolFn = LanguagePackContext['hashSymbol'];

const toRecord = (
  hashSymbol: HashSymbolFn,
  file: string,
  fileContainer: string[],
  symbol: InspectorSymbol
): SymbolRecord => {
  const containerPath =
    symbol.kind === 'method' && symbol.className !== undefined ? [...fileContainer, symbol.className] : fileContainer;
  return {
    hash: hashSymbol({
      lang: langId,
      kind: symbol.kind,
      containerPath,
      // The inspector output is comment-free (AST-reconstructed), so the kernel normalizer only
      // has whitespace/punctuation spacing left to canonicalize.
      normalizedDeclaration: normalizeDeclaration(symbol.declaration)
    }),
    lang: langId,
    kind: symbol.kind,
    name: symbol.name,
    containerPath,
    file,
    span: [symbol.lineno, symbol.end_lineno],
    visibility: 'public',
    signature: symbol.signature.slice(0, signatureMaxLength),
    project: '.'
  };
};

const parseInspectorOutput = (stdout: string): z.infer<typeof inspectorOutputSchema> => {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    throw new PythonInspectorError(`output is not JSON: ${stdout.slice(0, 200)}`);
  }
  const parsed = inspectorOutputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PythonInspectorError(`unexpected output shape:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
};

export const extractSymbols = async (ctx: LanguagePackContext): Promise<SymbolRecord[]> => {
  if (ctx.files.length === 0) {
    return [];
  }
  const interpreter = await requirePythonInterpreter();
  const inspectorPath = await resolveInspectorPath();
  const records: SymbolRecord[] = [];
  // Chunked so argv stays bounded on large repos.
  for (const chunk of chunksOf(ctx.files, chunkSize)) {
    const run = await runProcess(interpreter, [inspectorPath, ...chunk], {
      cwd: ctx.repoRoot,
      timeoutMs: inspectorTimeoutMs
    });
    if (run.timedOut) {
      throw new PythonInspectorError(`timed out after ${inspectorTimeoutMs}ms`);
    }
    if (run.exitCode !== 0) {
      throw new PythonInspectorError(`exit code ${run.exitCode}: ${run.stderr.trim()}`);
    }
    for (const entry of parseInspectorOutput(run.stdout).files) {
      if ('error' in entry) {
        // Per-file syntax errors never fail the batch: warn and move on, like the TS pack does
        // for unparseable sources.
        ctx.logger.warn(`lang-python: could not parse ${entry.file}: ${entry.error}`);
        continue;
      }
      const fileContainer = moduleSegments(entry.file);
      for (const symbol of entry.symbols) {
        records.push(toRecord(ctx.hashSymbol, entry.file, fileContainer, symbol));
      }
    }
  }
  return records;
};
