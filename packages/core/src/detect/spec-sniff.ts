import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { readFileHead } from './readme-signals.ts';

// OpenAPI/AsyncAPI spec sniffing, bounded for <1s on big repos: only the repo root plus two
// directory levels are walked, dot-directories and build output are skipped, and content sniffing
// reads at most the first 4KB of each candidate. Pure fs reads only — no subprocesses, no agents.

const MAX_DEPTH = 2;
const MAX_SNIFFED_FILES = 400;
const SNIFF_BYTES = 4096;

const skippedDirs = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', 'target', 'vendor']);

const specExtension = /\.(json|ya?ml)$/i;
const openapiFileName = /^(openapi|swagger)[^\\/]*\.(json|ya?ml)$/i;
const asyncapiFileName = /^asyncapi[^\\/]*\.(json|ya?ml)$/i;
// Well-known manifests that can never be API specs — not worth a read.
const neverSpecFileName =
  /^(package(-lock)?\.json|tsconfig[^\\/]*\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|lerna\.json|composer\.json|deno\.jsonc?|[^\\/]*\.config\.(json|ya?ml))$/i;

// A spec document starts with its version key: `openapi: 3.1.0` / `"swagger": "2.0"` / etc.
// YAML requires the key at column 0; JSON requires the quoted key with a numeric-looking value.
const yamlSpecKey = /(^|\r?\n)['"]?(openapi|swagger|asyncapi)['"]?\s*:\s*['"]?\d/;
const jsonSpecKey = /"(openapi|swagger|asyncapi)"\s*:\s*"?\d/;

type SpecKind = 'openapi' | 'asyncapi';

const sniffSpecKind = async (absPath: string, fileName: string): Promise<SpecKind | undefined> => {
  const head = await readFileHead(absPath, SNIFF_BYTES);
  if (head === undefined) {
    return undefined;
  }
  const isJson = /\.json$/i.test(fileName);
  const match = head.match(isJson ? jsonSpecKey : yamlSpecKey);
  const key = isJson ? match?.[1] : match?.[2];
  if (key === undefined) {
    return undefined;
  }
  return key.toLowerCase() === 'asyncapi' ? 'asyncapi' : 'openapi';
};

export type SpecScanResult = {
  openapiSpecs: string[];
  asyncapiSpecs: string[];
};

export const scanForSpecs = async (repoRoot: string): Promise<SpecScanResult> => {
  const openapiSpecs: string[] = [];
  const asyncapiSpecs: string[] = [];
  let sniffedCount = 0;

  const walk = async (relDir: string, depth: number): Promise<void> => {
    let entries;
    try {
      entries = await readdir(join(repoRoot, relDir), { withFileTypes: true });
    } catch {
      return;
    }
    const subdirs: string[] = [];
    for (const entry of entries) {
      const rel = relDir === '' ? entry.name : `${relDir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (depth < MAX_DEPTH && !entry.name.startsWith('.') && !skippedDirs.has(entry.name)) {
          subdirs.push(rel);
        }
        continue;
      }
      if (!entry.isFile() || !specExtension.test(entry.name)) {
        continue;
      }
      if (openapiFileName.test(entry.name)) {
        openapiSpecs.push(rel);
        continue;
      }
      if (asyncapiFileName.test(entry.name)) {
        asyncapiSpecs.push(rel);
        continue;
      }
      if (neverSpecFileName.test(entry.name) || sniffedCount >= MAX_SNIFFED_FILES) {
        continue;
      }
      sniffedCount += 1;
      const kind = await sniffSpecKind(join(repoRoot, rel), entry.name);
      if (kind === 'openapi') {
        openapiSpecs.push(rel);
      } else if (kind === 'asyncapi') {
        asyncapiSpecs.push(rel);
      }
    }
    await Promise.all(subdirs.map((subdir) => walk(subdir, depth + 1)));
  };

  await walk('', 0);
  return { openapiSpecs: openapiSpecs.toSorted(), asyncapiSpecs: asyncapiSpecs.toSorted() };
};
