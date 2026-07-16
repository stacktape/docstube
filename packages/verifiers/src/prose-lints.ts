import type { Finding } from '@docstube/contracts';
import type { PageArtifact, VerifierDefinition } from '@docstube/plugin-sdk';
import { runVerifier } from './run-support.ts';

const verifierId = 'prose-lints';

// Anti-slop lints (PRODUCT §4.1): deterministic style checks for AI-generated prose. Findings are
// always warnings — style feedback goes back into the refine loop but never blocks the gate.

const bannedPhrases = [
  'delve',
  'seamlessly',
  'leverage the power',
  "in today's fast-paced",
  "it's worth noting",
  'furthermore, ',
  'moreover, ',
  'in conclusion',
  'game-changer',
  'unlock the full potential',
  'dive deep',
  'robust and scalable'
];

const escapeForRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

const bannedPhrasePatterns = bannedPhrases.map((phrase) => {
  const startsWithWord = /^[\p{L}\p{N}]/u.test(phrase);
  const endsWithWord = /[\p{L}\p{N}]$/u.test(phrase);
  return {
    phrase: phrase.trim().replace(/,$/u, ''),
    pattern: new RegExp(`${startsWithWord ? '\\b' : ''}${escapeForRegex(phrase)}${endsWithWord ? '\\b' : ''}`, 'giu')
  };
});

// Blanks out a matched region while preserving newlines, so every downstream line number still
// refers to the original MDX.
const blankOut = (match: string): string => match.replace(/[^\n]/gu, ' ');

// Prose only: strip fenced code blocks, inline code spans, MDX import/export statements, and
// JSX/HTML tags before any lint looks at the text. Line structure is preserved exactly so every
// reported line number refers to the original MDX.
export const extractProse = (mdx: string): string => {
  const lines = mdx.split('\n');
  const kept: string[] = [];
  let openFenceLength = 0;
  for (const line of lines) {
    if (openFenceLength > 0) {
      const closing = /^ {0,3}(`{3,})\s*$/u.exec(line);
      if (closing && (closing[1]?.length ?? 0) >= openFenceLength) {
        openFenceLength = 0;
      }
      kept.push('');
      continue;
    }
    const opening = /^ {0,3}(`{3,})([^`]*)$/u.exec(line);
    if (opening) {
      openFenceLength = opening[1]?.length ?? 3;
      kept.push('');
      continue;
    }
    if (/^\s*(?:import|export)\s/u.test(line)) {
      kept.push('');
      continue;
    }
    kept.push(line.replace(/`[^`\n]*`/gu, blankOut));
  }
  // Tags are stripped on the joined text so multi-line JSX openings disappear too; blankOut keeps
  // every newline in place.
  return kept.join('\n').replace(/<\/?[A-Za-z][^<>]*>/gu, blankOut);
};

const lineOfOffset = (text: string, offset: number): number => text.slice(0, offset).split('\n').length;

type Sentence = { firstWord: string; wordCount: number; line: number };

// Sentences within one paragraph-ish segment: headings and blank lines break segments so a lint
// never counts a heading and body text as "consecutive sentences".
export const extractSentenceSegments = (prose: string): Sentence[][] => {
  const segments: Sentence[][] = [];
  let segmentStart: number | undefined;
  const lines = prose.split('\n');
  let offset = 0;
  const flush = (end: number): void => {
    if (segmentStart === undefined) {
      return;
    }
    const segmentText = prose.slice(segmentStart, end);
    const sentences: Sentence[] = [];
    for (const match of segmentText.matchAll(/[^.!?]+[.!?]+|[^.!?]+$/gu)) {
      const raw = match[0].trim();
      const firstWord = /[\p{L}\p{N}'’-]+/u.exec(raw)?.[0]?.toLowerCase();
      if (!firstWord) {
        continue;
      }
      sentences.push({
        firstWord,
        wordCount: raw.split(/\s+/u).filter((word) => /[\p{L}\p{N}]/u.test(word)).length,
        line: lineOfOffset(prose, segmentStart + match.index + (match[0].length - match[0].trimStart().length))
      });
    }
    if (sentences.length > 0) {
      segments.push(sentences);
    }
    segmentStart = undefined;
  };
  for (const line of lines) {
    const isBoundary = line.trim() === '' || /^ {0,3}#{1,6}\s/u.test(line) || /^ {0,3}([-*+]|\d+\.)\s/u.test(line);
    if (isBoundary) {
      flush(offset);
    } else if (segmentStart === undefined) {
      segmentStart = offset;
    }
    offset += line.length + 1;
  }
  flush(prose.length);
  return segments;
};

const pageFinding = (artifact: PageArtifact, message: string, span: [number, number]): Finding => ({
  source: 'lint',
  check: verifierId,
  severity: 'warning',
  message,
  entity: { version: artifact.version, locale: artifact.locale, pageId: artifact.page.id },
  file: artifact.mdxPath,
  span
});

const repetitionRunLength = 3;
const monotonyRunLength = 6;
const monotonyTolerance = 3;

const lintPage = (artifact: PageArtifact): Finding[] => {
  const findings: Finding[] = [];
  const prose = extractProse(artifact.mdx);

  for (const { phrase, pattern } of bannedPhrasePatterns) {
    pattern.lastIndex = 0;
    for (const match of prose.matchAll(pattern)) {
      const line = lineOfOffset(prose, match.index);
      findings.push(pageFinding(artifact, `banned phrase "${phrase}" — rewrite without the AI-ism`, [line, line]));
    }
  }

  for (const sentences of extractSentenceSegments(prose)) {
    // Repetition: 3+ consecutive sentences opening with the same word.
    let runStart = 0;
    for (let index = 1; index <= sentences.length; index += 1) {
      if (index < sentences.length && sentences[index]?.firstWord === sentences[runStart]?.firstWord) {
        continue;
      }
      const runLength = index - runStart;
      const first = sentences[runStart];
      const last = sentences[index - 1];
      if (runLength >= repetitionRunLength && first && last) {
        findings.push(
          pageFinding(
            artifact,
            `${runLength} consecutive sentences start with "${first.firstWord}" — vary sentence openings`,
            [first.line, last.line]
          )
        );
      }
      runStart = index;
    }

    // Monotony: 6+ consecutive sentences within ±3 words of the run's first sentence length.
    let index = 0;
    while (index < sentences.length) {
      const base = sentences[index];
      if (!base) {
        break;
      }
      let end = index + 1;
      while (
        end < sentences.length &&
        Math.abs((sentences[end]?.wordCount ?? 0) - base.wordCount) <= monotonyTolerance
      ) {
        end += 1;
      }
      const runLength = end - index;
      const last = sentences[end - 1];
      if (runLength >= monotonyRunLength && last) {
        findings.push(
          pageFinding(
            artifact,
            `${runLength} consecutive sentences are all about ${base.wordCount} words long — vary sentence length`,
            [base.line, last.line]
          )
        );
        index = end;
      } else {
        index += 1;
      }
    }
  }

  return findings;
};

export const proseLintsVerifier: VerifierDefinition = {
  id: verifierId,
  title: 'Prose avoids AI slop',
  description:
    'Deterministic anti-slop style lints: banned AI-isms, repetitive sentence openings, and monotone sentence lengths. All findings are warnings — style feedback informs refinement but never blocks the gate. Code fences, inline code, and JSX are excluded.',
  scope: 'page',
  localeScope: 'per-locale',
  proves: false,
  verify: (_ctx, pages) =>
    runVerifier(verifierId, async () => ({
      findings: pages.flatMap((artifact) => lintPage(artifact)),
      coveredEntityIds: pages.map((artifact) => artifact.page.id)
    }))
};
