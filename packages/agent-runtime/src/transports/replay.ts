import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hashValue, transcriptSchema } from '@docstube/contracts';
import type { AgentTaskSpec, Transcript } from '@docstube/contracts';
import { ReplayMismatchError } from '../errors.ts';
import type { ReplayTransport, Transport } from '../transport.ts';

// The replay transport plays recorded transcripts and is the only transport CI may use
// (ARCHITECTURE.md §8.3). Fixtures are plain Transcript JSON files. Matching order:
//   1. transcript.cacheKey === the computed cache key (exact input match), then
//   2. the (kind, userPrompt-hash) filename convention written by recordingWrapper.

export const replayFixtureFileName = (spec: Pick<AgentTaskSpec, 'kind' | 'userPrompt'>): string =>
  `${spec.kind}.${hashValue(spec.userPrompt).slice(0, 16)}.json`;

const loadFixture = async (dir: string, file: string): Promise<Transcript | undefined> => {
  try {
    const parsed = transcriptSchema.safeParse(JSON.parse(await readFile(join(dir, file), 'utf8')));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
};

export const createReplayTransport = (fixturesDir: string): ReplayTransport => ({
  mode: 'replay',
  id: 'replay',
  capabilities: { toolInjection: 'none', structuredOutput: true },
  loadTranscript: async ({ spec, cacheKey }) => {
    let files: string[] = [];
    try {
      files = (await readdir(fixturesDir)).filter((file) => file.endsWith('.json')).toSorted();
    } catch {
      files = [];
    }
    for (const file of files) {
      const fixture = await loadFixture(fixturesDir, file);
      if (fixture?.cacheKey === cacheKey) {
        return fixture;
      }
    }
    const fallbackName = replayFixtureFileName(spec);
    if (files.includes(fallbackName)) {
      const fixture = await loadFixture(fixturesDir, fallbackName);
      if (fixture) {
        return fixture;
      }
    }
    throw new ReplayMismatchError({
      message: `no replay fixture matches task kind "${spec.kind}" (cacheKey ${cacheKey}, fallback file ${fallbackName}) in ${fixturesDir}`,
      availableFixtures: files
    });
  }
});

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Strips absolute repo paths out of recorded strings so fixtures are machine-independent:
// "<repoRoot>/src/a.ts" and "<repoRoot>\src\a.ts" both become "src/a.ts".
const stripAbsolutePaths = (text: string, repoRoot: string): string => {
  const variants = [...new Set([repoRoot, repoRoot.split('\\').join('/')])].filter((variant) => variant.length > 2);
  let output = text;
  for (const variant of variants) {
    const pattern = new RegExp(`${escapeRegExp(variant)}([\\\\/][^\\s"'\`]*)?`, 'g');
    output = output.replace(pattern, (_match, rest: string | undefined) =>
      rest ? rest.slice(1).split('\\').join('/') : '.'
    );
  }
  return output;
};

const sanitizeValue = (value: unknown, repoRoot: string): unknown => {
  if (typeof value === 'string') {
    return stripAbsolutePaths(value, repoRoot);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, repoRoot));
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, sanitizeValue(entry, repoRoot)])
    );
  }
  return value;
};

export const sanitizeTranscript = (transcript: Transcript, repoRoot: string): Transcript =>
  transcriptSchema.parse(sanitizeValue(transcript, repoRoot));

// Wraps any transport so every finished transcript is also persisted as a sanitized replay
// fixture under the given directory (named by the kind + userPrompt-hash convention).
export const recordingWrapper = <T extends Transport>(transport: T, fixturesDir: string): T => ({
  ...transport,
  onTranscript: async (input) => {
    await transport.onTranscript?.(input);
    await mkdir(fixturesDir, { recursive: true });
    const sanitized = sanitizeTranscript(input.transcript, input.repoRoot);
    await writeFile(
      join(fixturesDir, replayFixtureFileName(input.spec)),
      `${JSON.stringify(sanitized, null, 2)}\n`,
      'utf8'
    );
  }
});
