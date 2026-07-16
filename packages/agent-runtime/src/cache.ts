import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { transcriptSchema } from '@docstube/contracts';
import type { Transcript } from '@docstube/contracts';

// Transcript cache on a directory: one JSON file per cache key (keys are sha256 hex, so they are
// filename-safe). Entries are validated on read — a corrupt or outdated file is a miss, never a crash.

export type TranscriptCache = {
  get: (cacheKey: string) => Promise<Transcript | undefined>;
  put: (transcript: Transcript) => Promise<void>;
};

export const createTranscriptCache = (dir: string): TranscriptCache => ({
  get: async (cacheKey) => {
    try {
      const raw = await readFile(join(dir, `${cacheKey}.json`), 'utf8');
      const parsed = transcriptSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  },
  put: async (transcript) => {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${transcript.cacheKey}.json`), `${JSON.stringify(transcript, null, 2)}\n`, 'utf8');
  }
});
