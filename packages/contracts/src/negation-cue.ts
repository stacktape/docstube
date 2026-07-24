// The ONE shared negation-cue vocabulary for prose↔ledger binding (wave 2b close, polarity
// finding): cited-value binding and subject binding must agree on what counts as an explicit
// denial, or a writer could launder polarity through whichever side uses the looser rule.
// Deliberately CONSERVATIVE and window-scoped: a cue counts only in a short character window
// around the bound token, so "— not a promise" at the end of a sentence never flips the polarity
// of a subject asserted positively at its start.

// Cues that deny what FOLLOWS them ("not 3", "never greet", "rather than retry", "instead of
// createClient"): scanned in the window BEFORE an occurrence. This is the full historical
// cited-value set — its window semantics are unchanged.
const BEFORE_CUE = /\b(?:not|never|cannot|no longer|rather than|instead of)\b|n't\b/iu;

// Cues that deny a SUBJECT's own predicate phrase ("greet does not exist", "retry never throws",
// "mode can no longer be set", "greet doesn't validate"): scanned in the window AFTER a subject
// token. 'rather than'/'instead of' are excluded here — AFTER a subject they deny the OTHER
// alternative ("use greet rather than shout" asserts greet positively).
const AFTER_CUE = /\b(?:not|never|cannot|no longer)\b|n't\b/iu;

const BEFORE_WINDOW = 32;

// Shorter than the before-window on purpose: the verb-phrase negations it exists to catch ("does
// not", "is not", "will never", "can no longer") sit within a few words of the subject, while a
// negation about some OTHER thing later in the sentence ("`greet` returns a string — not a
// promise") sits beyond it.
const AFTER_WINDOW = 20;

// True when a denial cue appears shortly BEFORE the occurrence at `index` — the sentence names
// the token only to deny it.
export const negationCueBefore = (text: string, index: number): boolean =>
  BEFORE_CUE.test(text.slice(Math.max(0, index - BEFORE_WINDOW), index));

// True when a subject-denying cue appears shortly AFTER the occurrence ending at `endIndex` —
// the sentence asserts the subject's absence or non-behavior.
export const negationCueAfter = (text: string, endIndex: number): boolean =>
  AFTER_CUE.test(text.slice(endIndex, endIndex + AFTER_WINDOW));
