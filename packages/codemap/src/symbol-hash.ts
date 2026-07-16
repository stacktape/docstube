import { canonicalJson, sha256Hex } from '@docstube/contracts';

// Kernel-owned symbol hashing (ARCHITECTURE.md §4, §7). The hash is the provenance key: every
// language pack MUST hash through this module so hashes stay comparable across packs and
// docstube versions.

// Normalizes declaration text before hashing so that comment and whitespace edits — including
// reformatting a declaration across lines — do not change a symbol's hash: strips C-style block
// and line comments, collapses every whitespace run (newlines included) to a single space, then
// drops the space wherever either neighbor is punctuation, so only whitespace that separates two
// identifier-ish tokens survives. Packs for languages with different comment syntax (e.g. Python
// `#`) should pre-strip their comments before calling this; the whitespace handling is
// language-agnostic.
export const normalizeDeclaration = (source: string): string => {
  const unix = source.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  const withoutBlockComments = unix.replaceAll(/\/\*[\s\S]*?\*\//gu, '');
  const withoutLineComments = withoutBlockComments.replaceAll(/(^|\s)\/\/.*$/gmu, '$1');
  const collapsed = withoutLineComments.replaceAll(/\s+/gu, ' ');
  return collapsed.replaceAll(/(?<![\w$]) | (?![\w$])/gu, '').trim();
};

export type HashSymbolInput = {
  lang: string;
  kind: string;
  containerPath: string[];
  normalizedDeclaration: string;
};

// Returns a sourceKey (`<lang>:<sha256hex>`, see @docstube/contracts sourceKeySchema).
//
// The identifier name is deliberately NOT a separate field of the hash input: keying symbols to
// bare names is the anti-pattern PRODUCT §3.2 forbids (stale-name hallucinations survive renames
// when the key is the name). The name still reaches the hash *through* `normalizedDeclaration` —
// the declaration text contains the name as written in source — which is exactly what we want:
// it disambiguates two otherwise identical-shape symbols in the same container (overloads, twin
// helpers), and it makes a rename change the hash, so the diff surfaces remove + add and every
// dependent entity regenerates. That is intended behavior, not a bug.
export const hashSymbol = (input: HashSymbolInput): string => {
  const digest = sha256Hex(
    canonicalJson({
      kind: input.kind,
      containerPath: input.containerPath,
      normalizedDeclaration: input.normalizedDeclaration
    })
  );
  return `${input.lang}:${digest}`;
};
