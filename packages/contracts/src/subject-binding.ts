// SUBJECT BINDING — the deterministic prose↔evidence subject rule (impl-09 finding 1), sibling of
// cited-value-binding. It closes the last laundering route: evidence may only mint when the
// claim's VISIBLE prose (or its predicate) actually names the subject the evidence points at.
// Without it, "`inventedFunction` exists" could ride an unrelated real symbol's hash into
// 'checked', and "`INVENTED_DEFAULT` is 3" could launder through any real value that happens to
// equal 3 — scalar binding succeeds, and verification would trust whichever proposed symbol/value
// name resolves.
//
// THE RULE (deterministic, shared verbatim by anchoring and claim verification):
//   - The bindable subject names are the CODEMAP RECORD's display name for the referenced symbol
//     (never the writer's own proposal text — genuine aliasing like prose `createClient` against
//     the codemap symbol createClient keeps passing), plus, for value-predicate evidence, every
//     IDENTIFIER SEGMENT of the cited-value name path ('retryDefaults.backoff.factor' offers
//     retryDefaults, backoff, and the leaf factor; the structural grammar keywords 'param' and
//     'default' are NEVER bindable — "the default is 3" must not bind X.param.retries.default).
//   - The claim is subject-bound when AT LEAST ONE bindable name occurs as an IDENTIFIER TOKEN
//     (verbatim, case-sensitive, delimited by non-identifier characters on both sides) in the
//     marker's visible text OR in the predicate. Backticks, quotes, dots, parentheses, and
//     sentence punctuation all delimit; 'retry' never binds inside 'retries' or 'retryCount'.
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

// The identifier segments of a cited-value name path that may bind the subject.
export const valueNameBindableSegments = (valueName: string): string[] =>
  valueName
    .split('.')
    .filter((segment) => IDENTIFIER_SEGMENT.test(segment) && !VALUE_NAME_GRAMMAR_KEYWORDS.has(segment));

export type SubjectBindingInput = {
  // The codemap record's display name for the symbol the evidence points at — resolved by the
  // kernel, never taken from writer output.
  subjectName: string;
  // For value claims: the cited-value name paths subscribed on this symbol; their identifier
  // segments extend the bindable name set (root identifier or leaf path segment both bind).
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
      // Every name that WOULD have bound — repair messages list them so the writer knows what the
      // sentence must actually say.
      candidates: string[];
    };

export const bindClaimSubject = (input: SubjectBindingInput): SubjectBindingResult => {
  const candidates = [
    input.subjectName,
    ...(input.valueNames ?? []).flatMap((valueName) => valueNameBindableSegments(valueName))
  ].filter((name, index, all) => name !== '' && all.indexOf(name) === index);
  const boundName = candidates.find(
    (name) => identifierOccursAsToken(name, input.markerText) || identifierOccursAsToken(name, input.predicate)
  );
  return boundName === undefined ? { ok: false, candidates } : { ok: true, boundName };
};
