// Deterministic failure-capable-assertion detection (impl-07 finding 2; PRODUCT §3.2's
// "doctest-style" rule is the governing decision): a snippet may decide a behavior claim ONLY
// when its source contains at least one construct that could make the process exit non-zero when
// the claim is false. A trivially assertion-free snippet (console.log only) proves nothing about
// behavior no matter what its fence declares via covers=.
//
// The detection is CONSERVATIVE and documented per language; when unsure, the answer is false and
// no evidence mints. String literals and comments are stripped first so "assert" inside a log
// message or comment never counts.
//
// js / ts (run via `node`, exit code = unhandled throw or explicit process.exit):
//   - an assert(...) or assert.method(...) call — console.assert is EXCLUDED (it logs and
//     returns; it never fails the process);
//   - an expect(...) call (throw-on-mismatch assertion style);
//   - a `throw` statement;
//   - an explicit non-zero process.exit(n) path.
//
// bash / sh (run via `bash -euo pipefail`, so a failing conditional aborts non-zero):
//   - a [[ ... ]] or [ ... ] conditional, or the `test` builtin;
//   - grep -q (presence assertion — exits 1 on no match);
//   - an explicit non-zero `exit n`.
//
// Any other language: unknown, therefore false.

const stripJsStringsAndComments = (source: string): string => {
  let out = '';
  let index = 0;
  while (index < source.length) {
    const ch = source[index] as string;
    const next = source[index + 1];
    if (ch === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') {
        index += 1;
      }
      continue;
    }
    if (ch === '/' && next === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        index += 1;
      }
      index += 2;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      index += 1;
      while (index < source.length && source[index] !== ch) {
        if (source[index] === '\\') {
          index += 1;
        }
        index += 1;
      }
      index += 1;
      out += ' ';
      continue;
    }
    out += ch;
    index += 1;
  }
  return out;
};

const stripBashStringsAndComments = (source: string): string => {
  let out = '';
  let index = 0;
  while (index < source.length) {
    const ch = source[index] as string;
    const previous = index === 0 ? '\n' : (source[index - 1] as string);
    if (ch === '#' && /[\s\n;(]/.test(previous)) {
      while (index < source.length && source[index] !== '\n') {
        index += 1;
      }
      continue;
    }
    if (ch === "'") {
      index += 1;
      while (index < source.length && source[index] !== "'") {
        index += 1;
      }
      index += 1;
      out += ' ';
      continue;
    }
    if (ch === '"') {
      index += 1;
      while (index < source.length && source[index] !== '"') {
        if (source[index] === '\\') {
          index += 1;
        }
        index += 1;
      }
      index += 1;
      out += ' ';
      continue;
    }
    out += ch;
    index += 1;
  }
  return out;
};

const JS_LANGUAGES = new Set(['js', 'javascript', 'ts', 'typescript']);
const BASH_LANGUAGES = new Set(['bash', 'sh']);

const JS_ASSERTION_PATTERNS = [
  // assert(...) / assert.strictEqual(...) — but never console.assert(...).
  /(?<!console\s*\.\s*)\bassert\s*(?:\.\s*\w+\s*)?\(/u,
  /\bexpect\s*\(/u,
  /\bthrow\b/u,
  /\bprocess\s*\.\s*exit\s*\(\s*[1-9]/u
];

const BASH_ASSERTION_PATTERNS = [
  /\[\[/u,
  /(?:^|[\s;&|(!])\[\s/u,
  /(?:^|[\s;&|(!])test\s/u,
  /\bgrep\s[^\n]*-[A-Za-z]*q/u,
  /\bexit\s+[1-9]/u
];

// True only when the snippet source provably contains a failure-capable assertion construct for
// its language. Unknown languages and undetectable constructs return false — no evidence.
export const detectFailureCapableAssertion = (language: string, source: string): boolean => {
  const normalized = language.toLowerCase();
  if (JS_LANGUAGES.has(normalized)) {
    const stripped = stripJsStringsAndComments(source);
    return JS_ASSERTION_PATTERNS.some((pattern) => pattern.test(stripped));
  }
  if (BASH_LANGUAGES.has(normalized)) {
    const stripped = stripBashStringsAndComments(source);
    return BASH_ASSERTION_PATTERNS.some((pattern) => pattern.test(stripped));
  }
  return false;
};

// The runtime a snippet language actually executes under (bash snippets record bash, not node).
export const snippetRuntimeOf = (language: string): 'bash' | 'node' =>
  BASH_LANGUAGES.has(language.toLowerCase()) ? 'bash' : 'node';
