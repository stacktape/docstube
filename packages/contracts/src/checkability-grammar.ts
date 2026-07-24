// CHECKABILITY GRAMMAR — EXACT CANONICAL VISIBLE MATCH (wave 2b close FINAL, impl-13). It ends
// both the polarity arms race AND the vocabulary arms race: existence and value evidence
// (codemap grounding, the value-predicate comparison) may DECIDE a claim only when the marker's
// VISIBLE text — what the reader actually sees — after minimal cosmetic normalization, EXACTLY
// matches one canonical assertion whose parameters equal the kernel-bound subject (the codemap
// record's display name) and, for value claims, the bound normalized citedValue; AND the claim's
// predicate matches the SAME canonical assertion (the two sides may differ only in the cosmetic
// normalization). There is no token window, no neutral allowlist, no denial screen, and no
// tokenizer: ANY other character or word in the visible span — 'returns', 'absent', a distant
// clause, non-Latin prose, anything — simply fails the exact match, and the claim stays honestly
// 'unchecked' / 'no-checker-available' with a journaled note. Fail-closed by construction:
// nothing needs to be enumerated for unknown prose to be refused.
//
// THE GRAMMAR (0.1.0):
//   existence:  <subject> exists | <subject> is defined | <subject> is available |
//               <subject> is exported
//               (the '… is exported from <module>' variant is REMOVED: the module side was never
//               verified by any evidence, so "exported from `fiction`" could mint checked. v1.x
//               may reintroduce it with a codemap-verified module binding.)
//   value:      <bound-value-path-subject> (is set to | defaults to | equals | is) <value>
//               (longest-first alternation so 'is' never swallows 'is set to'; <value> must
//               normalize — via the shared cited-value normalization — to EXACTLY the claim's
//               bound citedValue: same kind, same canonical bytes.)
//
// VALUE-PATH SUBJECT (wave 2b close final, impl-14): the value assertion's subject must be the
// FULL bound cited-value path in its ONE documented rendering — renderValuePathSubject below:
//   - object properties / enum members: the dot-joined path itself ('configFileNames.config',
//     'retryDefaults.backoff.factor', 'LogLevel.Warn');
//   - parameter defaults ('owner.param.<name>.default'): 'owner(<name>)' — e.g.
//     'createClient(retries) defaults to 3'. The raw grammar path spells structural keywords
//     ('param', 'default') that read as prose stutter ("….default defaults to 3"), so the
//     call-shaped rendering is the one canonical spelling.
// The ROOT OBJECT alone NEVER substitutes for a bound path: 'configFileNames is docstube.yml'
// asserts a value for the whole object while the evidence proves only the .config leaf — an
// evidence/prose subject mismatch the reader cannot see. Const names whose value path IS the
// root ('DEFAULT_RETRIES defaults to 3') are unchanged.
//
// MINIMAL COSMETIC NORMALIZATION, both sides: Unicode NFC, whitespace collapsed to single
// spaces, one optional trailing period dropped. Nothing else — no case folding on identifiers,
// no punctuation tolerance, no stemming, and NO backtick stripping: the marker side is
// AST-derived rendered text where inline-code formatting already contributed its bare content,
// so any backtick still present (an escaped \` in the source) is LITERAL content and must fail
// the exact match ('greet ex`ists' is not 'greet exists'). The predicate side is plain ledger
// text and must spell identifiers bare.
//
// The documented COST of fail-closed: wordy-but-true positives ("`greet`, added in v2, exists")
// ship honestly unchecked. The writer prompt teaches the fix — the marker wraps ONLY the
// canonical assertion; surrounding prose goes outside the marker.
//
// This grammar is the EVIDENCE-DECISION backstop, enforced at claim verification. The
// negation-cue fast paths (subject-binding polarity-mismatch, cited-value negation) are NO LONGER
// LOAD-BEARING for trust: they stay only as earlier, better-messaged REPAIR errors where they
// already fire — bypassing them just lands here. Anchoring may journal a non-blocking
// destined-unchecked hint so the retry loop can improve phrasing opportunistically — never a
// blocking error.

import { normalizeCitedValue } from './cited-value-binding.ts';
import type { NormalizedCitedValue } from './cited-value-binding.ts';

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The one cosmetic normalization both sides pass through before the exact comparison. NO
// backtick handling: AST-derived visible text is already bare, so a surviving backtick is
// literal content and must break the match.
export const canonicalizeAssertionText = (text: string): string => {
  const collapsed = text.normalize('NFC').replace(/\s+/gu, ' ').trim();
  return collapsed.endsWith('.') ? collapsed.slice(0, -1) : collapsed;
};

export const existenceAssertionForms = ['exists', 'is defined', 'is available', 'is exported'] as const;
export type ExistenceAssertionForm = (typeof existenceAssertionForms)[number];

// The ONE documented rendering of a bound cited-value path as an assertion subject (see header):
// parameter defaults render call-shaped ('createClient(retries)'); every other path renders as
// the dot-joined path itself. This is the only accepted subject spelling for the bound value —
// the root object alone never substitutes.
export const renderValuePathSubject = (valueName: string): string => {
  const parameterDefault = valueName.match(/^(?<owner>.+)\.param\.(?<param>[^.]+)\.default$/u);
  if (parameterDefault?.groups !== undefined) {
    return `${parameterDefault.groups.owner}(${parameterDefault.groups.param})`;
  }
  return valueName;
};

// Longest alternative first: JS alternation is ordered, and a bare 'is' matching ahead of
// 'is set to' would leave 'set to …' glued onto the value.
const VALUE_VERBS = ['is set to', 'defaults to', 'equals', 'is'] as const;

type ParsedValueAssertion = { subject: string; verb: string; valueSpelling: string };

// Parse a canonicalized text as EXACTLY '<subject-or-bound-value-path> <verb> <value>' — the
// whole string, nothing before, nothing after. Subject alternatives are the kernel-bound
// spellings only (the codemap display name and the bound cited-value paths), longest first so a
// dotted path is never truncated at its root.
const parseValueAssertion = (subjectPaths: string[], text: string): ParsedValueAssertion | undefined => {
  const subjectAlternatives = subjectPaths
    .toSorted((a, b) => b.length - a.length)
    .map((path) => escapeRegExp(path))
    .join('|');
  const match = text.match(new RegExp(`^(${subjectAlternatives}) (${VALUE_VERBS.join('|')}) (.+)$`, 'u'));
  if (match === null) {
    return undefined;
  }
  return { subject: match[1]!, verb: match[2]!, valueSpelling: match[3]! };
};

export type CheckabilityStyle = 'existence' | 'value';

export type CheckabilityInput = {
  // Which evidence style would decide the claim: codemap grounding (existence) or the
  // value-predicate comparison (value).
  style: CheckabilityStyle;
  // The CODEMAP record's display name for the bound subject — the same root identifier subject
  // binding proved on both sides. Never writer-proposed text.
  subjectName: string;
  // For value claims: the cited-value name paths bound on this symbol — each full path is an
  // accepted subject spelling in the canonical assertion.
  valueNames?: string[] | undefined;
  // For value claims: the claim's asserted citedValue (any accepted spelling — normalized here).
  citedValue?: string | undefined;
  // AST-derived rendered text of the inline marker — what the reader sees.
  markerText: string;
  // The claim's atomic predicate.
  predicate: string;
};

export type CheckabilityAssessment =
  // `form` reports WHICH canonical existence assertion matched (undefined for value claims):
  // claim verification needs it because 'is exported' additionally requires the symbol record to
  // affirmatively indicate exportedness before grounding may decide the claim.
  | { checkable: true; form?: ExistenceAssertionForm }
  | { checkable: false; gate: 'canonical-predicate' | 'canonical-visible'; reason: string };

const notCheckable = (gate: 'canonical-predicate' | 'canonical-visible', reason: string): CheckabilityAssessment => ({
  checkable: false,
  gate,
  reason
});

// THE decision: may existence/value evidence decide this claim's correctness? Deterministic and
// side-effect free; claim verification is the enforcement point.
export const assessClaimCheckability = (input: CheckabilityInput): CheckabilityAssessment => {
  const subject = input.subjectName;
  const visible = canonicalizeAssertionText(input.markerText);
  const predicate = canonicalizeAssertionText(input.predicate);

  if (input.style === 'existence') {
    const matchedForm = existenceAssertionForms.find((form) => predicate === `${subject} ${form}`);
    if (matchedForm === undefined) {
      return notCheckable(
        'canonical-predicate',
        `the predicate "${input.predicate}" is not a canonical existence assertion about "${subject}" — ` +
          `canonical forms: ${existenceAssertionForms.map((form) => `"${subject} ${form}"`).join(', ')}`
      );
    }
    if (visible !== predicate) {
      return notCheckable(
        'canonical-visible',
        `the visible marked prose "${input.markerText}" is not exactly the canonical assertion ` +
          `"${predicate}" — the marker must wrap ONLY the canonical assertion (whitespace and one trailing ` +
          'period are tolerated; a literal backtick is content and breaks the match); every other word goes ' +
          'outside the marker'
      );
    }
    return { checkable: true, form: matchedForm };
  }

  if (input.citedValue === undefined) {
    return notCheckable('canonical-predicate', 'a value claim with no bound citedValue is never checkable');
  }
  const bound = normalizeCitedValue(input.citedValue);
  // FULL VALUE-PATH SUBJECT: when cited-value paths are bound, ONLY their rendered spellings are
  // accepted subjects — the root object alone never substitutes ('configFileNames' never stands
  // in for 'configFileNames.config'). A const whose path IS the root keeps working because the
  // rendered path equals it. Without bound paths (defensive: verification always binds them),
  // the codemap display name is the only subject there is.
  const renderedPaths = (input.valueNames ?? [])
    .map((name) => renderValuePathSubject(name))
    .filter((path, index, all) => all.indexOf(path) === index);
  const subjectPaths = renderedPaths.length > 0 ? renderedPaths : [subject];
  const spellsBoundValue = (spelling: string): boolean => {
    const normalized: NormalizedCitedValue = normalizeCitedValue(spelling);
    return normalized.kind === bound.kind && normalized.canonical === bound.canonical;
  };
  const canonicalShape =
    `"<subject> is set to|defaults to|equals|is ${bound.canonical}" where <subject> is EXACTLY the rendered ` +
    `bound value path (${subjectPaths.map((name) => `"${name}"`).join(', ')}) — the root object name alone ` +
    'never substitutes for a nested path';

  const predicateAssertion = parseValueAssertion(subjectPaths, predicate);
  if (predicateAssertion === undefined || !spellsBoundValue(predicateAssertion.valueSpelling)) {
    return notCheckable(
      'canonical-predicate',
      `the predicate "${input.predicate}" is not a canonical value assertion — canonical form: ${canonicalShape}`
    );
  }
  const visibleAssertion = parseValueAssertion(subjectPaths, visible);
  if (visibleAssertion === undefined || !spellsBoundValue(visibleAssertion.valueSpelling)) {
    return notCheckable(
      'canonical-visible',
      `the visible marked prose "${input.markerText}" is not exactly a canonical value assertion — canonical ` +
        `form: ${canonicalShape}. The marker must wrap ONLY the canonical assertion; every other word goes ` +
        'outside the marker'
    );
  }
  if (visibleAssertion.subject !== predicateAssertion.subject || visibleAssertion.verb !== predicateAssertion.verb) {
    return notCheckable(
      'canonical-visible',
      `the visible marked prose ("${visibleAssertion.subject} ${visibleAssertion.verb} …") and the predicate ` +
        `("${predicateAssertion.subject} ${predicateAssertion.verb} …") state DIFFERENT canonical assertions — ` +
        'both sides must state the same one, differing only in cosmetic normalization'
    );
  }
  return { checkable: true };
};
