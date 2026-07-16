import type { Codemap } from '@docstube/contracts';
import type { ExtractedClaim } from './extract-claims.ts';

// Deterministic claim matching — the half of audit that makes the metric trustworthy. No AI here:
// a reported defect is an identifier that verifiably does not exist in the codemap (the
// Tan/Wagner/Treude stale-reference class). The design rule is NEVER OVERCLAIM: anything we
// cannot deterministically check lands in 'unverifiable', which counts in the metric's
// denominator but never as a defect (knowledge/design/audit.md).

// Language/runtime ambients no repo codemap contains — matching them is impossible, so claims
// resting only on these are unverifiable, not defective.
const ambientIdentifiers = new Set([
  'string',
  'number',
  'boolean',
  'object',
  'symbol',
  'bigint',
  'undefined',
  'null',
  'void',
  'any',
  'unknown',
  'never',
  'true',
  'false',
  'Array',
  'ArrayBuffer',
  'BigInt',
  'Boolean',
  'Buffer',
  'Date',
  'Error',
  'Function',
  'Infinity',
  'JSON',
  'Map',
  'Math',
  'NaN',
  'Number',
  'Object',
  'Promise',
  'Proxy',
  'Reflect',
  'RegExp',
  'Set',
  'String',
  'Symbol',
  'TypeError',
  'URL',
  'URLSearchParams',
  'WeakMap',
  'WeakSet',
  'console',
  'fetch',
  'globalThis',
  'process',
  'require',
  'window'
]);

// Only identifier-shaped tokens are checkable in v1. Paths, URLs, CLI flags, shell fragments are
// real claim subjects but need dedicated verifiers (v2 direction) — they must not become defects.
const identifierPattern = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/u;

// Strip the decorations docs put around identifiers: backticks, call parens, generics, and the
// `Class#method` convention (normalized to a dotted path).
export const normalizeIdentifier = (raw: string): string | undefined => {
  const stripped = raw
    .trim()
    .replaceAll('`', '')
    .replace(/<[^<>]*>/gu, '')
    .replace(/\([^()]*\)$/u, '')
    .replaceAll('#', '.')
    .trim();
  if (stripped === '' || !identifierPattern.test(stripped)) {
    return undefined;
  }
  return stripped;
};

export type CodemapIndex = {
  // Exact symbol names ("greet", "sayHello").
  names: Set<string>;
  // Every containerPath segment ("greeter", "Greeter") — module and class containers.
  containerSegments: Set<string>;
  // Dotted containerPath-tail + name suffixes ("Greeter.sayHello", "src.greeter.greet").
  dottedTails: Set<string>;
};

export const buildCodemapIndex = (codemap: Codemap): CodemapIndex => {
  const names = new Set<string>();
  const containerSegments = new Set<string>();
  const dottedTails = new Set<string>();
  for (const symbol of codemap.symbols) {
    names.add(symbol.name);
    for (const segment of symbol.containerPath) {
      containerSegments.add(segment);
    }
    for (let start = 0; start < symbol.containerPath.length; start += 1) {
      dottedTails.add([...symbol.containerPath.slice(start), symbol.name].join('.'));
    }
  }
  return { names, containerSegments, dottedTails };
};

const identifierExists = (identifier: string, index: CodemapIndex): boolean => {
  if (!identifier.includes('.')) {
    return index.names.has(identifier) || index.containerSegments.has(identifier);
  }
  // Dotted paths must match a real container-tail + name suffix — both halves merely existing
  // somewhere is not evidence the qualified path is real.
  return index.dottedTails.has(identifier);
};

export type ClaimDefect = {
  kind: 'stale-reference';
  identifier: string;
  reason: string;
};

export type ClaimMatch =
  | { status: 'grounded' }
  | { status: 'unverifiable'; reason: string }
  | { status: 'defect'; defects: ClaimDefect[] };

// TODO(v2, knowledge/design/audit.md): claims of class 'code-sample' whose anchor quote parses as
// TypeScript could be typechecked via the language packs' snippetToolchain.typecheck (already
// shipped by @docstube/lang-typescript). That needs the async plugin-host context threaded in and
// a second defect kind; v1 keeps matching purely synchronous name/path lookup.
export const matchClaim = (claim: ExtractedClaim, index: CodemapIndex): ClaimMatch => {
  if (claim.identifiers.length === 0) {
    return { status: 'unverifiable', reason: 'claim references no code identifiers' };
  }
  const checkable: string[] = [];
  for (const raw of claim.identifiers) {
    const normalized = normalizeIdentifier(raw);
    if (normalized !== undefined && !ambientIdentifiers.has(normalized)) {
      checkable.push(normalized);
    }
  }
  if (checkable.length === 0) {
    return {
      status: 'unverifiable',
      reason: 'no identifier is checkable against the codemap (ambient or non-identifier tokens only)'
    };
  }
  const missing = checkable.filter((identifier) => !identifierExists(identifier, index));
  // Live-calibrated policy (never overclaim): a claim usually names its anchor symbol PLUS
  // incidental parameter/property tokens ("greet", "options.loud") — if ANY checkable identifier
  // grounds, the claim is anchored to real API and the stragglers are not evidence of staleness.
  // Only a claim where EVERY checkable identifier fails to ground is a stale-reference defect.
  if (missing.length < checkable.length) {
    return { status: 'grounded' };
  }
  const defects: ClaimDefect[] = missing.map((identifier) => ({
    kind: 'stale-reference' as const,
    identifier,
    reason: `identifier "${identifier}" does not exist in the codemap (no matching symbol name, container, or dotted path)`
  }));
  return { status: 'defect', defects };
};
