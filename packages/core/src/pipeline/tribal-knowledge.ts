import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { z } from 'zod';
import type { Codemap, Flag, PageShard, ToolDescriptor } from '@docstube/contracts';
import { idPrefixes, mintId, sha256Hex, splitFrontmatter } from '@docstube/contracts';
import type { ManifestStore } from '../state/manifest-store.ts';

// Tribal-knowledge capture (PRODUCT §4.1): when generation hits something the code cannot answer
// ("why was X deprecated?"), the writer asks ONCE through a harness tool. Generation never waits:
// the question becomes a tribal-knowledge flag (the human touchpoint), and once a human answers,
// the answer is committed to .docstube/knowledge/ and injected into every future writer prompt.
// Ask-once = dedup by normalized-question hash across open flags AND stored answers.

const knowledgeDir = (repoRoot: string): string => join(repoRoot, '.docstube', 'knowledge');

export const questionKey = (question: string): string =>
  sha256Hex(question.trim().toLowerCase().replace(/\s+/gu, ' ')).slice(0, 16);

// Retry attempts reword the same question ("no main/exports — what's the import path?" came back
// three ways in one live run), so exact-hash dedup alone triples the maintainer's queue.
// Containment (shared content words / smaller question) is robust to one phrasing being much
// longer than the other; measured on the live trio it scores 0.56-0.75 vs 0.0-0.13 for genuinely
// different questions. A false merge only costs the writer one extra ask next run.
const QUESTION_STOPWORDS = new Set(
  'the a an is are was were be been it its this that there no not or and of in on for to with what which who how why should would could can has have had do does did e.g i.e from at by as if but so into than then using used use'.split(
    ' '
  )
);

export const questionTokens = (question: string): Set<string> =>
  new Set((question.toLowerCase().match(/[a-z0-9_./-]+/gu) ?? []).filter((token) => !QUESTION_STOPWORDS.has(token)));

export const questionsSimilar = (a: string, b: string): boolean => {
  const tokensA = questionTokens(a);
  const tokensB = questionTokens(b);
  const smaller = Math.min(tokensA.size, tokensB.size);
  if (smaller === 0) {
    return false;
  }
  // Containment over-merges very short questions (2 content tokens sharing 1 already scores 0.5),
  // so it only applies when the smaller side has enough tokens to be meaningful; below that,
  // only the exact normalized hash counts as "the same question".
  if (smaller < 4) {
    return questionKey(a) === questionKey(b);
  }
  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) {
      intersection += 1;
    }
  }
  return intersection / smaller >= 0.5;
};

export type KnowledgeEntry = {
  key: string;
  question: string;
  answer: string;
  subjectSymbol?: string | undefined;
};

const knowledgeFrontmatterSchema = z.object({
  question: z.string().min(1),
  subjectSymbol: z.string().optional(),
  answeredAt: z.string().optional()
});

export const loadKnowledge = async (repoRoot: string): Promise<KnowledgeEntry[]> => {
  let files: string[];
  try {
    files = (await readdir(knowledgeDir(repoRoot))).filter((name) => name.endsWith('.md')).toSorted();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  const entries: KnowledgeEntry[] = [];
  for (const name of files) {
    const raw = await readFile(join(knowledgeDir(repoRoot), name), 'utf8');
    // The shared splitter (contracts/src/frontmatter.ts) owns the tolerant rules: knowledge files
    // are committed, so a Windows autocrlf checkout hands us \r\n and an editor may prepend a BOM —
    // either would silently drop every stored answer under a strict pattern.
    const split = splitFrontmatter(raw);
    if (!split.hadFrontmatter) {
      continue;
    }
    const frontmatter = knowledgeFrontmatterSchema.safeParse(parse(split.frontmatter));
    if (!frontmatter.success) {
      continue;
    }
    entries.push({
      key: name.slice(0, -'.md'.length),
      question: frontmatter.data.question,
      answer: split.body.trim(),
      subjectSymbol: frontmatter.data.subjectSymbol
    });
  }
  return entries;
};

export const writeKnowledgeAnswer = async (
  repoRoot: string,
  input: { question: string; answer: string; subjectSymbol?: string | undefined }
): Promise<string> => {
  const key = questionKey(input.question);
  await mkdir(knowledgeDir(repoRoot), { recursive: true });
  const frontmatter = stringify({
    question: input.question,
    ...(input.subjectSymbol === undefined ? {} : { subjectSymbol: input.subjectSymbol }),
    answeredAt: new Date().toISOString()
  });
  await writeFile(
    join(knowledgeDir(repoRoot), `${key}.md`),
    `---\n${frontmatter}---\n\n${input.answer.trim()}\n`,
    'utf8'
  );
  return key;
};

// The answering loop closes here: humans answer a tribal-knowledge flag (flag queue UI, or by
// editing the shard YAML / responding to the digest issue and having the answer applied). At the
// start of every run, answered flags are persisted to the knowledge store and marked resolved —
// so the answer is committed, durable, and injected from now on.
export const applyFlagAnswers = async (input: {
  repoRoot: string;
  store: ManifestStore;
  locales: string[];
  pageIds: string[];
}): Promise<number> => {
  let applied = 0;
  for (const locale of input.locales) {
    for (const pageId of input.pageIds) {
      const shard = await input.store.readPageShard({ locale, pageId });
      if (shard === undefined) {
        continue;
      }
      let changed = false;
      const flags: Flag[] = [];
      for (const flag of shard.flags) {
        if (flag.kind === 'tribal-knowledge' && flag.status === 'answered' && flag.answer && flag.question) {
          await writeKnowledgeAnswer(input.repoRoot, {
            question: flag.question,
            answer: flag.answer.text,
            subjectSymbol: flag.subjectSymbol
          });
          flags.push({ ...flag, status: 'resolved' });
          changed = true;
          applied += 1;
        } else {
          flags.push(flag);
        }
      }
      if (changed) {
        await input.store.writePageShard({ ...shard, flags });
      }
    }
  }
  return applied;
};

// `texts` seeds the paraphrase dedup in questionsToFlags: it carries every open question AND —
// when the caller passes the knowledge store — every already-ANSWERED question, so a reworded
// version of an answered question never re-enters the queue.
export type OpenQuestions = { keys: Set<string>; texts: string[] };

export const collectOpenQuestions = async (input: {
  store: ManifestStore;
  locales: string[];
  pageIds: string[];
  // Answered knowledge entries; their question texts join the paraphrase-dedup corpus.
  knowledge?: readonly KnowledgeEntry[] | undefined;
}): Promise<OpenQuestions> => {
  const keys = new Set<string>();
  const texts: string[] = (input.knowledge ?? []).map((entry) => entry.question);
  for (const locale of input.locales) {
    for (const pageId of input.pageIds) {
      const shard = await input.store.readPageShard({ locale, pageId });
      for (const flag of shard?.flags ?? []) {
        if (flag.kind === 'tribal-knowledge' && flag.status === 'open' && flag.question) {
          if (!keys.has(questionKey(flag.question))) {
            texts.push(flag.question);
          }
          keys.add(questionKey(flag.question));
        }
      }
    }
  }
  return { keys, texts };
};

export type CapturedQuestion = {
  question: string;
  subject?: string | undefined;
  context?: string | undefined;
};

const flagQuestionParams = z.object({
  question: z.string().min(8),
  subject: z.string().optional(),
  context: z.string().optional()
});

export const flagQuestionDescriptor: ToolDescriptor = {
  name: 'flag_question',
  description:
    'Ask the maintainers something the code cannot answer (intent, history, "why"). Non-blocking: keep writing with what IS knowable; the answer arrives on a future run. Use `subject` to name the symbol/file the question is about.',
  paramsJsonSchema: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'The question for the maintainers, self-contained.' },
      subject: { type: 'string', description: 'Symbol or file the question is about (optional).' },
      context: { type: 'string', description: 'Why the answer matters for the docs (optional).' }
    },
    required: ['question']
  }
};

export type QuestionCollector = {
  tool: { descriptor: ToolDescriptor; handler: (args: unknown) => Promise<unknown> };
  questions: () => CapturedQuestion[];
};

export const createQuestionCollector = (): QuestionCollector => {
  const captured: CapturedQuestion[] = [];
  return {
    tool: {
      descriptor: flagQuestionDescriptor,
      handler: async (args) => {
        const parsed = flagQuestionParams.parse(args);
        captured.push(parsed);
        return {
          recorded: true,
          note: 'Question flagged for the maintainers. Continue writing with what the code supports.'
        };
      }
    },
    questions: () => [...captured]
  };
};

// Subjects arrive as free text ("greet", "src/retry.ts", "Retry.run"); resolve to a symbol hash
// when the reference is unambiguous, else leave the flag unkeyed (still useful, just not durable
// per-symbol context).
export const resolveSubjectSymbol = (codemap: Codemap, subject: string | undefined): string | undefined => {
  if (subject === undefined) {
    return undefined;
  }
  const needle = subject.trim();
  const dottedTail = needle.split('.').at(-1) ?? needle;
  const matches = codemap.symbols.filter(
    (symbol) => symbol.name === needle || symbol.name === dottedTail || symbol.file === needle
  );
  return matches.length === 1 ? matches[0]?.hash : undefined;
};

// Merge captured questions into a page shard's flags, ask-once: skip anything already answered
// (knowledge) or already open anywhere (openQuestions covers every shard, not just this page),
// exactly or as a paraphrase — openQuestions.texts includes answered-question texts when the
// caller threads the knowledge store through collectOpenQuestions.
export const questionsToFlags = (input: {
  questions: CapturedQuestion[];
  codemap: Codemap;
  knowledgeKeys: ReadonlySet<string>;
  openQuestions: OpenQuestions;
  shard: Pick<PageShard, 'locale' | 'version'>;
  pageId: string;
  runId: string;
}): Flag[] => {
  const flags: Flag[] = [];
  const seenThisPage = new Set<string>();
  const seenTexts = [...input.openQuestions.texts];
  for (const question of input.questions) {
    const key = questionKey(question.question);
    if (input.knowledgeKeys.has(key) || input.openQuestions.keys.has(key) || seenThisPage.has(key)) {
      continue;
    }
    // Paraphrase dedup: retry attempts reword the same fact gap; keep only the first phrasing.
    if (seenTexts.some((text) => questionsSimilar(text, question.question))) {
      continue;
    }
    seenThisPage.add(key);
    seenTexts.push(question.question);
    const subjectSymbol = resolveSubjectSymbol(input.codemap, question.subject);
    flags.push({
      id: mintId(idPrefixes.flag),
      kind: 'tribal-knowledge',
      status: 'open',
      summary: `writer question: ${question.question.slice(0, 120)}${question.question.length > 120 ? '…' : ''}`,
      ...(question.context === undefined ? {} : { detail: question.context }),
      question: question.question,
      ...(subjectSymbol === undefined ? {} : { subjectSymbol }),
      entity: { version: input.shard.version, locale: input.shard.locale, pageId: input.pageId },
      runId: input.runId,
      createdAt: new Date().toISOString()
    });
  }
  return flags;
};
