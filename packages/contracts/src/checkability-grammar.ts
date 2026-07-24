// CHECKABILITY GRAMMAR — the fail-closed canonical positive grammar (wave 2b close FINAL,
// impl-12). It ends the polarity arms race: instead of enumerating negation vocabulary and losing
// to the next synonym ('absent', 'gone', a distant 'does not'), the kernel only lets EXISTENCE and
// VALUE evidence (codemap-grounding, value-predicate) DECIDE a claim whose phrasing sits inside a
// small canonical grammar. Arbitrary prose outside the grammar is never argued with — the claim
// simply stays correctness 'unchecked' / disposition 'no-checker-available' with a journaled note.
// Unchecked is a legal outcome; a bypass is not.
//
// TWO GATES, both must pass (either failing ⇒ not mechanically checkable):
//
// GATE 1 — CANONICAL PREDICATE. The claim's atomic predicate must be a whole-string match of one
// documented family (anchored, case-sensitive on identifiers, backticks around identifiers
// permitted, one optional trailing period):
//   existence:  <subject> exists | <subject> is exported [from <module>] | <subject> is defined |
//               <subject> is available
//   value:      <subject-or-value-path> (is | equals | defaults to | is set to) <value>
//               where <value> must normalize (shared cited-value normalization) to exactly the
//               claim's bound citedValue — same kind, same canonical bytes.
//
// GATE 2 — VISIBLE-WINDOW ALLOWLIST. In the marker's VISIBLE text (what the reader sees), every
// word token within ±CHECKABILITY_WINDOW word tokens of each occurrence of the bound subject (and,
// for value claims, of the bound value) must be on the curated NEUTRAL_ALLOWLIST below, or be one
// of the claim's OWN bound tokens (the subject root, the cited-value path segments, tokens equal
// to the bound value, the gate-1 'exported from' module). ANY other token — 'absent', 'missing',
// 'formerly', an unrelated backticked identifier, ANY unknown word — makes the claim unchecked.
// Fail-closed by construction: unknown vocabulary is unchecked by default, so the bypass class
// cannot exist. As a window-independent backstop, an explicit DENIAL word anywhere in the visible
// text ('not', "n't", 'never', 'removed', …) also fails the gate — a denial pushed beyond the
// window by neutral filler must not slip through.
//
// The documented COST of fail-closed: wordy-but-true positives ("`greet`, added in v2, exists")
// ship honestly unchecked. The writer prompt teaches the fix — keep the marker span tight around
// the canonical assertion and put extra context outside the marker.
//
// This grammar is the EVIDENCE-DECISION backstop, enforced at claim verification. The existing
// negation-cue rejects (subject-binding polarity-mismatch, cited-value negation) stay as fast-path
// REPAIR errors for the common cases — they give better messages; the grammar is what makes
// bypassing them pointless. Anchoring may journal a non-blocking destined-unchecked hint so the
// retry loop can improve phrasing opportunistically — never a blocking error.

import { normalizeCitedValue } from './cited-value-binding.ts';
import type { NormalizedCitedValue } from './cited-value-binding.ts';

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ±N word tokens around each bound-token occurrence in the visible text.
export const CHECKABILITY_WINDOW = 5;

// The curated neutral vocabulary — the ONLY free words canonical checkable prose may use near the
// bound tokens. Deliberately small and lowercase (matched case-insensitively); everything else is
// unknown and therefore unchecked. Past-tense copulas are deliberately absent: "was exported"
// asserts history, which existence evidence cannot decide.
export const NEUTRAL_ALLOWLIST: ReadonlySet<string> = new Set([
  // articles + determiners
  'a',
  'an',
  'the',
  'this',
  'that',
  'its',
  // copulas + auxiliaries (present tense only)
  'is',
  'are',
  'be',
  'has',
  'have',
  // prepositions + conjunctions
  'to',
  'of',
  'in',
  'on',
  'at',
  'by',
  'for',
  'with',
  'as',
  'and',
  'from',
  // pronouns
  'it',
  // canonical assertion verbs
  'exists',
  'exist',
  'exported',
  'defined',
  'available',
  'defaults',
  'default',
  'equals',
  'set',
  'sets',
  'returns',
  // domain nouns
  'value',
  'option',
  'config',
  'parameter',
  'property',
  'field',
  'function',
  'constant',
  'method',
  'flag',
  'key'
]);

// Window-independent denial screen: any of these ANYWHERE in the visible marker text fails gate 2,
// so neutral filler can never push a denial beyond the token window. Strictly fail-closed — it
// only ever moves claims toward unchecked.
const DENIAL_VOCABULARY =
  /\b(?:not|no|none|never|cannot|without|absent|missing|removed|deleted|dropped|deprecated|discontinued|formerly|previously|unavailable|undefined|unsupported|gone|lacks?|neither|nor|except|unless)\b|n't\b/iu;

// Word tokens: identifier-shaped runs and numeric literals. Dots, backticks, quotes, dashes, and
// all punctuation delimit (and are themselves always permitted); "doesn't" tokenizes as
// 'doesn' + 't', both unknown — contractions fail closed on their own.
const WORD_TOKEN = /[A-Za-z_$][A-Za-z0-9_$]*|[0-9][0-9_]*(?:\.[0-9][0-9_]*)?(?:[eE][+-]?[0-9]+)?/gu;

const wordTokens = (text: string): string[] => [...text.matchAll(WORD_TOKEN)].map((match) => match[0]);

const IDENT = '[A-Za-z_$][A-Za-z0-9_$]*';

// Identifiers may be backticked in prose-adjacent predicates; a stray single backtick is harmless
// (the identifier itself is still matched verbatim).
const ticked = (inner: string): string => `\`?${inner}\`?`;

// GATE 1, existence family. Captures the optional 'exported from' module identifier so gate 2 can
// treat it as a claim-bound token.
const existencePredicateMatch = (subjectName: string, predicate: string): { moduleIdent?: string } | undefined => {
  const pattern = new RegExp(
    `^${ticked(escapeRegExp(subjectName))} (?:exists|is exported(?: from ${ticked(`(${IDENT})`)})?|is defined|is available)\\.?$`,
    'u'
  );
  const match = predicate.match(pattern);
  if (match === null) {
    return undefined;
  }
  return match[1] === undefined ? {} : { moduleIdent: match[1] };
};

// Longest alternative first: JS alternation is ordered, and a bare 'is' matching ahead of
// 'is set to' would leave 'set to …' glued onto the value.
const VALUE_VERBS = '(?:is set to|defaults to|equals|is)';

// GATE 1, value family: '<subject-or-value-path> <verb> <value>' where <value> must normalize to
// the claim's bound citedValue exactly (same kind, same canonical bytes — '4' never passes for a
// bound 3, and the quoted string "3" never passes for the number 3).
const valuePredicateMatch = (subjectPaths: string[], bound: NormalizedCitedValue, predicate: string): boolean => {
  const subjectAlternatives = subjectPaths.map((path) => ticked(escapeRegExp(path))).join('|');
  const match = predicate.match(new RegExp(`^(?:${subjectAlternatives}) ${VALUE_VERBS} (.+)$`, 'u'));
  if (match === null) {
    return false;
  }
  const tail = match[1] ?? '';
  const candidates = tail.endsWith('.') ? [tail, tail.slice(0, -1)] : [tail];
  return candidates.some((candidate) => {
    const normalized = normalizeCitedValue(candidate);
    return normalized.kind === bound.kind && normalized.canonical === bound.canonical;
  });
};

// A visible-text token that IS the bound value, in the value's own type: numeric tokens compare
// after numeric canonicalization; strings compare against the bare content (multi-token bare
// strings like 'exponential-backoff' contribute each of their word tokens).
const tokenMatchesValue = (token: string, value: NormalizedCitedValue): boolean => {
  if (value.kind === 'number') {
    return /^[0-9]/.test(token) && Number(token.replaceAll('_', '')) === Number(value.canonical);
  }
  if (value.kind === 'boolean' || value.kind === 'null') {
    return token.toLowerCase() === value.canonical;
  }
  const bare = value.bare ?? '';
  return token === bare || wordTokens(bare).includes(token);
};

export type CheckabilityStyle = 'existence' | 'value';

export type CheckabilityInput = {
  // Which evidence style would decide the claim: codemap grounding (existence) or the
  // value-predicate comparison (value).
  style: CheckabilityStyle;
  // The CODEMAP record's display name for the bound subject — the same root identifier subject
  // binding proved on both sides. Never writer-proposed text.
  subjectName: string;
  // For value claims: the cited-value name paths bound on this symbol. Their dot segments are
  // claim-bound tokens, and each full path is an accepted gate-1 subject spelling.
  valueNames?: string[] | undefined;
  // For value claims: the claim's asserted citedValue (any accepted spelling — normalized here).
  citedValue?: string | undefined;
  // AST-derived rendered text of the inline marker — what the reader sees.
  markerText: string;
  // The claim's atomic predicate.
  predicate: string;
};

export type CheckabilityAssessment =
  | { checkable: true }
  | { checkable: false; gate: 'canonical-predicate' | 'visible-window'; reason: string };

const notCheckable = (gate: 'canonical-predicate' | 'visible-window', reason: string): CheckabilityAssessment => ({
  checkable: false,
  gate,
  reason
});

// THE decision: may existence/value evidence decide this claim's correctness? Deterministic and
// side-effect free; claim verification is the enforcement point.
export const assessClaimCheckability = (input: CheckabilityInput): CheckabilityAssessment => {
  const subject = input.subjectName;

  // GATE 1 — canonical predicate.
  let moduleIdent: string | undefined;
  let boundValue: NormalizedCitedValue | undefined;
  if (input.style === 'existence') {
    const match = existencePredicateMatch(subject, input.predicate);
    if (match === undefined) {
      return notCheckable(
        'canonical-predicate',
        `the predicate "${input.predicate}" is not a canonical existence assertion about "${subject}" — ` +
          `canonical forms: "${subject} exists", "${subject} is exported [from <module>]", ` +
          `"${subject} is defined", "${subject} is available"`
      );
    }
    moduleIdent = match.moduleIdent;
  } else {
    if (input.citedValue === undefined) {
      return notCheckable('canonical-predicate', 'a value claim with no bound citedValue is never checkable');
    }
    boundValue = normalizeCitedValue(input.citedValue);
    const subjectPaths = [subject, ...(input.valueNames ?? [])].filter(
      (path, index, all) => all.indexOf(path) === index
    );
    if (!valuePredicateMatch(subjectPaths, boundValue, input.predicate)) {
      return notCheckable(
        'canonical-predicate',
        `the predicate "${input.predicate}" is not a canonical value assertion — canonical form: ` +
          `"<subject> is|equals|defaults to|is set to ${boundValue.canonical}" where <subject> is ` +
          `"${subject}" or a bound value path (${(input.valueNames ?? []).map((name) => `"${name}"`).join(', ') || 'none bound'})`
      );
    }
  }

  // GATE 2 — visible-window allowlist, with the window-independent denial screen first.
  const denial = input.markerText.match(DENIAL_VOCABULARY);
  if (denial !== null) {
    return notCheckable(
      'visible-window',
      `the visible marked prose contains the denial word "${denial[0]}" — checkable prose asserts the fact ` +
        'plainly, with no denial vocabulary anywhere inside the marker'
    );
  }
  const boundSegments = new Set<string>([
    subject,
    ...(input.valueNames ?? []).flatMap((name) => name.split('.').filter((segment) => segment !== '')),
    ...(moduleIdent === undefined ? [] : [moduleIdent])
  ]);
  const value = boundValue;
  const allowed = (token: string): boolean =>
    NEUTRAL_ALLOWLIST.has(token.toLowerCase()) ||
    boundSegments.has(token) ||
    (value !== undefined && tokenMatchesValue(token, value));

  const tokens = wordTokens(input.markerText);
  const anchorIndexes = tokens.flatMap((token, index) => {
    if (token === subject) {
      return [index];
    }
    if (value !== undefined && tokenMatchesValue(token, value)) {
      return [index];
    }
    return [];
  });
  if (!tokens.includes(subject)) {
    return notCheckable(
      'visible-window',
      `the visible marked prose never names the bound subject "${subject}" as a word token`
    );
  }
  if (value !== undefined && !tokens.some((token) => tokenMatchesValue(token, value))) {
    return notCheckable(
      'visible-window',
      `the visible marked prose never states the bound value ${value.canonical} as a word token`
    );
  }
  const offending: string[] = [];
  for (const anchor of anchorIndexes) {
    const start = Math.max(0, anchor - CHECKABILITY_WINDOW);
    const end = Math.min(tokens.length, anchor + CHECKABILITY_WINDOW + 1);
    for (let index = start; index < end; index += 1) {
      const token = tokens[index]!;
      if (!allowed(token) && !offending.includes(token)) {
        offending.push(token);
      }
    }
  }
  if (offending.length > 0) {
    return notCheckable(
      'visible-window',
      `the visible marked prose contains ${offending.map((token) => `"${token}"`).join(', ')} within ` +
        `${CHECKABILITY_WINDOW} words of the asserted subject/value — only neutral vocabulary and the claim's own ` +
        'bound tokens are checkable; move extra context outside the marker'
    );
  }
  return { checkable: true };
};
