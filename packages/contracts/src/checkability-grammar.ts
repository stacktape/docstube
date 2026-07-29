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
//   schema
//   presence:   <bound-schema-subject> (requires | accepts | defines | records | stores) <field>
//               (impl-16 gap 3 — the shape of a declared validation schema. 'requires' additionally
//               asserts the field is NOT input-optional; the other four assert presence only. The
//               verb set is exactly the one the live corpus uses; a synonym outside it fails the
//               exact match and the claim stays unchecked.)
//   schema
//   default:    <bound-schema-subject> defaults <field> to <value>
//               <bound-schema-subject>.<field> defaults to <value>
//               (the same fact in the two spellings documentation actually uses. <value> must
//               normalize to the field's statically extracted literal default.)
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
// PURE-MARKER PRECONDITION (wave 2b close final — the render-laundering class): the exact match
// vouches for the SCANNED text, so it may only run when the scanned text provably IS what the
// reader sees. That holds only when the marker's AST content consists EXCLUSIVELY of `text` and
// `inlineCode` nodes — the only node kinds whose rendered output equals their scanned value — AND
// the marker has NO JSX ANCESTOR. Any other content node (an image whose alt text scans but
// renders as a picture, a footnote reference that renders a superscript, a link, emphasis, html,
// a break — or a node kind that does not exist yet) makes the marker non-pure, and so does a
// marker sitting anywhere inside a component (<Badge label="greet does not exist."><Claim>greet
// exists.</Claim></Badge>): the component's renderer owns whether/how the Claim slot renders, so
// no scan can prove rendered ≡ scanned. Both directions fail closed by structure with no
// enumeration. JSX elements INSIDE the marker are additionally rejected outright at submit_page
// ('marker-jsx'); a JSX ANCESTOR is legal, repair-free MDX — the claim is simply permanently
// unchecked. Callers pass the scanner-computed `markerPureText` (which threads BOTH conditions);
// false short-circuits before any grammar.
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

// QUOTED-KEY SEGMENTS (impl-16 gap 2). Cited-value extraction already emits paths for quoted
// object keys and enum members, and those keys routinely contain hyphens ('claude-cli',
// 'openai-compatible', 'anthropic-api'). A hyphen is NOT an identifier character, so the plain
// identifier segment truncated such a path and the OPEN parsers below simply refused the whole
// assertion — the fact was extractable and citable, but unspellable. A segment is therefore an
// identifier optionally continued by hyphen-joined identifier chunks: hyphens may never lead,
// trail, or double, and NOTHING else widens — whitespace, quotes, slashes, and every other
// character still fail closed, so arbitrary text can never pass as a path.
const PATH_SEGMENT = '[A-Za-z_$][A-Za-z0-9_$]*(?:-[A-Za-z0-9_$]+)*';
const PATH = `${PATH_SEGMENT}(?:\\.${PATH_SEGMENT})*`;

// Longest alternative first: JS alternation is ordered, and a bare 'is' matching ahead of
// 'is set to' would leave 'set to …' glued onto the value.
const VALUE_VERBS = ['is set to', 'defaults to', 'equals', 'is'] as const;

export type ParsedValueAssertion = { subject: string; verb: string; valueSpelling: string };

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

// Identifier path / call-shaped subject, in the SAME two spellings renderValuePathSubject emits:
// 'DEFAULT_RETRIES', 'retryDefaults.backoff.factor', 'defaultModels.claude-cli',
// 'createClient(retries)'.
const OPEN_SUBJECT = `${PATH}(?:\\(${PATH_SEGMENT}\\))?`;

// THE OPEN VALUE-ASSERTION PARSER (kernel cited-value resolution): parses a canonical value
// assertion WITHOUT knowing the subject in advance, so the kernel can read the value PATH the
// claim itself asserts ('configFileNames.config is docstube.yml' → subject
// 'configFileNames.config', value spelling 'docstube.yml') and look it up in the run's fingerprint
// snapshot. parseValueAssertion above is the closed sibling: it proves a claim's phrasing against
// an ALREADY-BOUND subject and remains the only thing that decides checkability. This one only
// nominates a candidate — every binding, snapshot, and grammar check still runs afterwards.
export const parseValueAssertionText = (text: string): ParsedValueAssertion | undefined => {
  const match = canonicalizeAssertionText(text).match(
    new RegExp(`^(${OPEN_SUBJECT}) (${VALUE_VERBS.join('|')}) (.+)$`, 'u')
  );
  if (match === null) {
    return undefined;
  }
  return { subject: match[1]!, verb: match[2]!, valueSpelling: match[3]! };
};

// THE SCHEMA-PRESENCE VERB SET (impl-16 gap 3). Chosen from the live corpus, not invented: these
// are the five verbs documentation actually uses to state that a declared schema has a field.
// 'requires' additionally asserts the field is NOT input-optional; the other four assert presence
// only, so they hold for optional and defaulted fields alike. The set is CLOSED — a synonym
// ('exposes', 'has', 'declares') fails the exact match and the claim stays honestly unchecked.
export const schemaPresenceVerbs = ['requires', 'accepts', 'defines', 'records', 'stores'] as const;
export type SchemaPresenceVerb = (typeof schemaPresenceVerbs)[number];

export type ParsedSchemaPresenceAssertion = { subject: string; verb: SchemaPresenceVerb; field: string };
export type ParsedSchemaDefaultAssertion = { subject: string; field: string; valueSpelling: string };

// The schema SUBJECT is always a single segment: it names a declared schema symbol, and codemap
// display names are bare identifiers. Keeping the subject single-segment is what makes the dotted
// 'default' spelling ('<schema>.<field> defaults to <value>') unambiguously splittable.
const SCHEMA_PRESENCE_PATTERN = new RegExp(`^(${PATH_SEGMENT}) (${schemaPresenceVerbs.join('|')}) (${PATH})$`, 'u');
const SCHEMA_DEFAULT_SPLIT_PATTERN = new RegExp(`^(${PATH_SEGMENT}) defaults (${PATH}) to (.+)$`, 'u');
const SCHEMA_DEFAULT_PATH_PATTERN = new RegExp(`^(${PATH_SEGMENT})\\.(${PATH}) defaults to (.+)$`, 'u');

// OPEN schema-presence parser (kernel subject resolution): reads the schema symbol and the field a
// claim asserts WITHOUT knowing either in advance, so the kernel can resolve the subject in the
// codemap itself. It only NOMINATES — every binding, snapshot, and grammar check still runs after.
export const parseSchemaPresenceAssertionText = (text: string): ParsedSchemaPresenceAssertion | undefined => {
  const match = canonicalizeAssertionText(text).match(SCHEMA_PRESENCE_PATTERN);
  if (match === null) {
    return undefined;
  }
  return { subject: match[1]!, verb: match[2]! as SchemaPresenceVerb, field: match[3]! };
};

// OPEN schema-default parser, accepting BOTH documented spellings of the same fact:
//   'agentsConfigSchema defaults transport to claude-cli'
//   'docstubeConfigSchema.outDir defaults to docs-site'
// The split spelling is tried first: a dotted subject in the split form ('a.b defaults c to d') is
// still a split assertion, and the path form requires the literal ' defaults to '.
export const parseSchemaDefaultAssertionText = (text: string): ParsedSchemaDefaultAssertion | undefined => {
  const canonical = canonicalizeAssertionText(text);
  const split = canonical.match(SCHEMA_DEFAULT_SPLIT_PATTERN);
  if (split !== null) {
    return { subject: split[1]!, field: split[2]!, valueSpelling: split[3]! };
  }
  const path = canonical.match(SCHEMA_DEFAULT_PATH_PATTERN);
  if (path === null) {
    return undefined;
  }
  return { subject: path[1]!, field: path[2]!, valueSpelling: path[3]! };
};

// A spelling that is UNAMBIGUOUSLY A SCALAR LITERAL: a quoted string, or a single whitespace-free
// token. Descriptive predicates ("an empty array", "the user's login") are refused, so a
// kernel-derived comparison can never manufacture a contradiction out of prose that was never a
// literal value assertion. Shared by kernel cited-value resolution and the schema-default verifier.
export const isScalarLiteralSpelling = (spelling: string): boolean => {
  const quoteChars = ['"', "'", '`'];
  const isQuoted = quoteChars.some(
    (quote) => spelling.length >= 2 && spelling.startsWith(quote) && spelling.endsWith(quote)
  );
  return isQuoted || !/\s/u.test(spelling);
};

export type CheckabilityStyle = 'existence' | 'value' | 'schema-presence' | 'schema-default';

export type CheckabilityInput = {
  // Which evidence style would decide the claim: codemap grounding (existence) or the
  // value-predicate comparison (value).
  style: CheckabilityStyle;
  // Scanner-computed: true only when the marker's AST content is EXCLUSIVELY text + inlineCode
  // nodes AND the marker has no JSX ancestor (the pure-marker precondition above). false → never
  // checkable, before any grammar.
  markerPureText: boolean;
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
  // `presence`/`schemaDefault` carry the parsed schema assertion so the verifier reads the field
  // and verb from the SAME parse the grammar vouched for, never from a second, looser one.
  | {
      checkable: true;
      form?: ExistenceAssertionForm;
      presence?: ParsedSchemaPresenceAssertion;
      schemaDefault?: ParsedSchemaDefaultAssertion;
    }
  | { checkable: false; gate: 'marker-impure' | 'canonical-predicate' | 'canonical-visible'; reason: string };

const notCheckable = (
  gate: 'marker-impure' | 'canonical-predicate' | 'canonical-visible',
  reason: string
): CheckabilityAssessment => ({
  checkable: false,
  gate,
  reason
});

// THE decision: may existence/value evidence decide this claim's correctness? Deterministic and
// side-effect free; claim verification is the enforcement point.
export const assessClaimCheckability = (input: CheckabilityInput): CheckabilityAssessment => {
  if (!input.markerPureText) {
    return notCheckable(
      'marker-impure',
      'the marker is not pure — its content is not exclusively text + inline code (formatting, links, images, ' +
        'footnotes, breaks, …), or the marker sits inside a JSX component whose renderer decides what actually ' +
        'renders — so no evidence may vouch for what the reader sees. A checkable marker wraps ONLY plain prose ' +
        'and backticked identifiers and lives in a plain paragraph or list item, never inside a component'
    );
  }
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

  // SCHEMA ASSERTIONS (impl-16 gap 3) use the same exact-canonical-visible-match discipline as
  // existence: the predicate must BE one canonical schema assertion about the kernel-bound schema
  // subject, and the visible marked prose must be exactly that same assertion. What the assertion
  // says about the field is decided afterwards, against the statically extracted shape.
  if (input.style === 'schema-presence' || input.style === 'schema-default') {
    const parsed =
      input.style === 'schema-presence'
        ? parseSchemaPresenceAssertionText(predicate)
        : parseSchemaDefaultAssertionText(predicate);
    if (parsed === undefined || parsed.subject !== subject) {
      return notCheckable(
        'canonical-predicate',
        `the predicate "${input.predicate}" is not a canonical schema ` +
          `${input.style === 'schema-presence' ? 'presence' : 'default'} assertion about "${subject}" — canonical ` +
          `forms: ${
            input.style === 'schema-presence'
              ? schemaPresenceVerbs.map((verb) => `"${subject} ${verb} <field>"`).join(', ')
              : `"${subject} defaults <field> to <value>", "${subject}.<field> defaults to <value>"`
          }`
      );
    }
    if (
      input.style === 'schema-default' &&
      'valueSpelling' in parsed &&
      !isScalarLiteralSpelling(parsed.valueSpelling)
    ) {
      return notCheckable(
        'canonical-predicate',
        `the predicate "${input.predicate}" states a DESCRIPTIVE default ("${parsed.valueSpelling}"), not a scalar ` +
          'literal — a schema default is decided by comparing literals, so descriptive phrasing stays unchecked'
      );
    }
    if (visible !== predicate) {
      return notCheckable(
        'canonical-visible',
        `the visible marked prose "${input.markerText}" is not exactly the canonical assertion "${predicate}" — ` +
          'the marker must wrap ONLY the canonical assertion; every other word goes outside the marker'
      );
    }
    return input.style === 'schema-presence'
      ? { checkable: true, presence: parsed as ParsedSchemaPresenceAssertion }
      : { checkable: true, schemaDefault: parsed as ParsedSchemaDefaultAssertion };
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
