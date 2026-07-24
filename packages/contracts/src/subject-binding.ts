// SUBJECT BINDING — the deterministic prose↔evidence subject rule (impl-09 finding 1, tightened
// by impl-10 findings 1+2), sibling of cited-value-binding. It closes the laundering routes:
// evidence may only mint when the claim's subject is named by BOTH the VISIBLE prose the reader
// sees AND the predicate the ledger asserts. Without it, "`inventedFunction` exists" could ride an
// unrelated real symbol's hash into 'checked' (prose-side laundering), a predicate that quietly
// names the real symbol could carry visibly false prose (predicate-side laundering — the reader
// never sees the predicate), and a common value-path leaf like 'config' could bind unrelated
// values ("the Vite `config`" riding configFileNames.config).
//
// THE RULE (deterministic, shared verbatim by anchoring and claim verification — the same
// both-sides shape as the scalar rule in cited-value-binding):
//   - The MANDATORY bindable name is the ROOT IDENTIFIER: the CODEMAP RECORD's display name for
//     the referenced symbol (never the writer's own proposal text — genuine aliasing like prose
//     `createClient` against the codemap symbol createClient keeps passing). Cited-value name
//     paths are rooted at this same identifier ('retryDefaults.backoff.factor' roots at
//     retryDefaults).
//   - The claim is subject-bound ONLY when the root identifier occurs as an IDENTIFIER TOKEN
//     (verbatim, case-sensitive, delimited by non-identifier characters on both sides) in the
//     marker's VISIBLE text AND in the predicate. Either side alone is laundering: predicate-only
//     occurrence mints evidence for a subject the reader never sees; visible-only occurrence lets
//     the ledger assert a different subject than the prose shows. Backticks, quotes, dots,
//     parentheses, and sentence punctuation all delimit; 'retry' never binds inside 'retries'.
//   - The non-root IDENTIFIER SEGMENTS of a cited-value name path (backoff, factor — never the
//     structural grammar keywords 'param' and 'default') are additional CONTEXT the writer may
//     also name, but they can NEVER substitute for the root: common leaf words ('config', 'mode',
//     'default') occur across unrelated values, so a segment-only occurrence is rejected.
//
// Enforcement is two-layered: anchoring rejects with the repair-eligible 'subject-unbound' error
// (the writer fixes the prose or drops the wrong symbol); verification re-checks the same rule
// and mints NO evidence on violation — the claim stays unchecked with a journaled warning.

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const IDENTIFIER_CHAR = /[A-Za-z0-9_$]/;

// True when the identifier appears verbatim (case-sensitive) with no identifier character
// immediately before or after — a real token occurrence, never a fragment of a longer name.
export const identifierOccursAsToken = (identifier: string, text: string): boolean => {
  if (identifier === '') {
    return false;
  }
  const pattern = new RegExp(escapeRegExp(identifier), 'gu');
  for (const match of text.matchAll(pattern)) {
    const before = match.index > 0 ? text[match.index - 1] : undefined;
    const after = text[match.index + identifier.length];
    if (
      (before === undefined || !IDENTIFIER_CHAR.test(before)) &&
      (after === undefined || !IDENTIFIER_CHAR.test(after))
    ) {
      return true;
    }
  }
  return false;
};

// Structural keywords of the cited-value name grammar ('createClient.param.timeout.default') —
// they describe the path shape, not the subject, and appear constantly in ordinary prose.
const VALUE_NAME_GRAMMAR_KEYWORDS = new Set(['param', 'default']);

const IDENTIFIER_SEGMENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

// The identifier segments of a cited-value name path — CONTEXT names for repair messages. They
// never bind on their own (impl-10 finding 2): only the root identifier gates.
export const valueNameBindableSegments = (valueName: string): string[] =>
  valueName
    .split('.')
    .filter((segment) => IDENTIFIER_SEGMENT.test(segment) && !VALUE_NAME_GRAMMAR_KEYWORDS.has(segment));

export type SubjectBindingInput = {
  // The codemap record's display name for the symbol the evidence points at — resolved by the
  // kernel, never taken from writer output. This is the MANDATORY root identifier.
  subjectName: string;
  // For value claims: the cited-value name paths subscribed on this symbol. Their identifier
  // segments are context for repair messages only — they cannot substitute for the root.
  valueNames?: string[] | undefined;
  // AST-derived rendered text of the inline marker (link URLs/attributes excluded).
  markerText: string;
  // The claim's atomic predicate.
  predicate: string;
};

export type SubjectBindingResult =
  | { ok: true; boundName: string }
  | {
      ok: false;
      // The mandatory root identifier that failed to bind — repair messages demand it verbatim.
      requiredName: string;
      // The side(s) that never name the root: both must, so either entry alone fails the claim.
      missingIn: Array<'marker' | 'predicate'>;
      // Non-root cited-value path segments — listed as context in repair messages; naming them
      // never substitutes for naming the root.
      contextSegments: string[];
    };

export const bindClaimSubject = (input: SubjectBindingInput): SubjectBindingResult => {
  const root = input.subjectName;
  const missingIn: Array<'marker' | 'predicate'> = [];
  if (!identifierOccursAsToken(root, input.markerText)) {
    missingIn.push('marker');
  }
  if (!identifierOccursAsToken(root, input.predicate)) {
    missingIn.push('predicate');
  }
  if (missingIn.length === 0) {
    return { ok: true, boundName: root };
  }
  const contextSegments = (input.valueNames ?? [])
    .flatMap((valueName) => valueNameBindableSegments(valueName))
    .filter((name, index, all) => name !== root && name !== '' && all.indexOf(name) === index);
  return { ok: false, requiredName: root, missingIn, contextSegments };
};
