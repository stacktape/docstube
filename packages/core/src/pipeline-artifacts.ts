import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { agentRunResultSchema } from '@docstube/agent';
import type { AgentRunInput, AgentRunResult } from '@docstube/agent';
import type { Finding } from '@docstube/contracts';

export type RetryAttemptResult<T> =
  | { status: 'failed'; findings: Finding[]; value?: T }
  | { status: 'passed'; findings?: Finding[]; value: T }
  | { status: 'retry'; findings: Finding[]; value?: T };

export type RetryLoopResult<T> = {
  attempts: number;
  exhausted: boolean;
  findings: Finding[];
  status: 'failed' | 'passed';
  value?: T;
};

export const runRetryLoop = async <T>(input: {
  maxRetries: number;
  runAttempt: (attempt: number, previousFindings: readonly Finding[]) => Promise<RetryAttemptResult<T>>;
}): Promise<RetryLoopResult<T>> => {
  const runNext = async (attempt: number, previousFindings: readonly Finding[]): Promise<RetryLoopResult<T>> => {
    const result = await input.runAttempt(attempt, previousFindings);
    if (result.status === 'passed') {
      return {
        status: 'passed',
        attempts: attempt + 1,
        exhausted: false,
        findings: result.findings ?? [],
        value: result.value
      };
    }

    if (result.status === 'failed') {
      return {
        status: 'failed',
        attempts: attempt + 1,
        exhausted: false,
        findings: result.findings,
        value: result.value
      };
    }

    if (attempt >= input.maxRetries) {
      return {
        status: 'failed',
        attempts: input.maxRetries + 1,
        exhausted: true,
        findings: result.findings,
        ...(result.value === undefined ? {} : { value: result.value })
      };
    }

    return runNext(attempt + 1, result.findings);
  };

  return runNext(0, []);
};

export type AgentCacheKeyInput = {
  adapterId: string;
  adapterVersion: string;
  inputDigests: readonly { algorithm: 'sha256'; path: string; value: string }[];
  model: string;
  prompt: string;
};

export type CachedAgentRun = {
  cacheKey: string;
  hit: boolean;
  result: AgentRunResult;
};

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value).toSorted(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`).join(',')}}`;
  }

  return JSON.stringify(value);
};

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

export const deriveAgentCacheKey = (input: AgentCacheKeyInput): string => sha256(canonicalJson(input));

const cachePath = (cacheDir: string, cacheKey: string): string => join(cacheDir, `${cacheKey}.json`);

export const readCachedAgentRun = async (cacheDir: string, cacheKey: string): Promise<AgentRunResult | null> => {
  try {
    return agentRunResultSchema.parse(JSON.parse(await readFile(cachePath(cacheDir, cacheKey), 'utf8')));
  } catch {
    return null;
  }
};

export const writeCachedAgentRun = async (
  cacheDir: string,
  cacheKey: string,
  result: AgentRunResult
): Promise<void> => {
  await mkdir(cacheDir, { recursive: true });
  await writeFile(
    cachePath(cacheDir, cacheKey),
    `${JSON.stringify(agentRunResultSchema.parse(result), null, 2)}\n`,
    'utf8'
  );
};

export const runCachedAgentStep = async (input: {
  cacheDir: string;
  cacheKeyInput: AgentCacheKeyInput;
  run: () => Promise<AgentRunResult>;
}): Promise<CachedAgentRun> => {
  const cacheKey = deriveAgentCacheKey(input.cacheKeyInput);
  const cached = await readCachedAgentRun(input.cacheDir, cacheKey);
  if (cached) {
    return { cacheKey, hit: true, result: cached };
  }

  const result = await input.run();
  await writeCachedAgentRun(input.cacheDir, cacheKey, result);
  return { cacheKey, hit: false, result };
};

const secretPattern = /\b(sk-[A-Za-z0-9_-]{20,}|(?:api[_-]?key|password|secret|token)\s*[:=]\s*["']?[^\s"',}]+)/giu;

export const redactTranscriptValue = (value: unknown): unknown => {
  if (typeof value === 'string') {
    return value.replaceAll(secretPattern, '[REDACTED]');
  }
  if (Array.isArray(value)) {
    return value.map(redactTranscriptValue);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redactTranscriptValue(entry)]));
  }
  return value;
};

export const writeAgentTranscript = async (input: {
  input: AgentRunInput;
  result: AgentRunResult;
  runDir: string;
  stepId: string;
}): Promise<string> => {
  const path = join(input.runDir, 'transcripts', `${input.stepId}.json`);
  await mkdir(join(input.runDir, 'transcripts'), { recursive: true });
  await writeFile(
    path,
    `${JSON.stringify(redactTranscriptValue({ input: input.input, result: input.result }), null, 2)}\n`,
    'utf8'
  );
  return path;
};

export type DiffChangelogEntry = {
  additions: number;
  deletions: number;
  path: string;
  sourceDiffHash: string;
  summary: string;
};

export const generateChangelogFromDiff = (diff: string): DiffChangelogEntry[] => {
  const entries: DiffChangelogEntry[] = [];
  let current: { additions: number; deletions: number; path: string } | undefined;

  const flush = () => {
    if (!current) {
      return;
    }
    entries.push({
      ...current,
      sourceDiffHash: sha256(diff),
      summary: `${current.path}: ${current.additions} additions, ${current.deletions} deletions`
    });
  };

  for (const line of diff.split(/\r?\n/u)) {
    const fileMatch = /^diff --git a\/(.+?) b\/(.+)$/u.exec(line);
    if (fileMatch) {
      flush();
      current = { path: fileMatch[2]!, additions: 0, deletions: 0 };
      continue;
    }

    if (!current || line.startsWith('+++') || line.startsWith('---')) {
      continue;
    }
    if (line.startsWith('+')) {
      current.additions += 1;
    } else if (line.startsWith('-')) {
      current.deletions += 1;
    }
  }

  flush();
  return entries;
};

export const createFaqAeoWriterGuidance = (input: { facts: readonly string[]; pageTitle: string }): string =>
  [
    `FAQ/AEO guidance for ${input.pageTitle}`,
    '',
    'Only add FAQ answers that are directly supported by these source-grounded facts:',
    ...input.facts.map((fact) => `- ${fact}`),
    '',
    'If a question cannot be answered from the facts, omit it instead of guessing.'
  ].join('\n');
