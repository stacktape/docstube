import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgentRunInput, AgentRunResult } from '@docstube/agent';
import type { Finding } from '@docstube/contracts';
import {
  createFaqAeoWriterGuidance,
  deriveAgentCacheKey,
  generateChangelogFromDiff,
  runCachedAgentStep,
  runRetryLoop,
  writeAgentTranscript
} from './pipeline-artifacts.ts';

const timestamp = '2026-06-16T00:00:00.000Z';

const finding: Finding = {
  code: 'mdx-compile',
  severity: 'major',
  origin: 'verifier',
  message: 'MDX did not compile.'
};

const agentInput: AgentRunInput = {
  taskId: 'writer-overview',
  model: 'replay-fixture',
  prompt: 'Write docs without leaking sk-123456789012345678901234.',
  sandbox: {
    readOnlyRoots: ['C:/repo'],
    writableRoots: ['C:/repo/docs'],
    allowNetwork: false,
    shell: 'none'
  },
  metadata: { token: 'secret=do-not-store' }
};

const agentResult: AgentRunResult = {
  adapterId: 'replay',
  adapterVersion: '0.0.0',
  status: 'completed',
  startedAt: timestamp,
  completedAt: timestamp,
  events: [
    {
      type: 'run-started',
      sequence: 0,
      timestamp,
      adapterId: 'replay',
      adapterVersion: '0.0.0',
      model: 'replay-fixture',
      sandbox: agentInput.sandbox
    },
    { type: 'run-completed', sequence: 1, timestamp, exitCode: 0 }
  ],
  artifacts: [],
  output: { message: 'generated without password=top-secret' }
};

const withTempDir = async (run: (dir: string) => Promise<void>) => {
  const dir = await mkdtemp(join(tmpdir(), 'docstube-artifacts-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

describe('retry loop', () => {
  it('retries until a later attempt passes', async () => {
    const attempts: number[] = [];
    const result = await runRetryLoop({
      maxRetries: 2,
      async runAttempt(attempt) {
        attempts.push(attempt);
        return attempt < 1 ? { status: 'retry', findings: [finding] } : { status: 'passed', value: 'ok' };
      }
    });

    expect(attempts).toEqual([0, 1]);
    expect(result).toMatchObject({ status: 'passed', attempts: 2, exhausted: false, value: 'ok' });
  });

  it('reports exhaustion when retry findings remain', async () => {
    const result = await runRetryLoop({
      maxRetries: 1,
      async runAttempt() {
        return { status: 'retry', findings: [finding] };
      }
    });

    expect(result).toEqual({ status: 'failed', attempts: 2, exhausted: true, findings: [finding] });
  });
});

describe('agent cache and transcripts', () => {
  it('uses content-addressed cache keys and returns cache hits', async () => {
    await withTempDir(async (dir) => {
      const cacheKeyInput = {
        adapterId: 'replay',
        adapterVersion: '0.0.0',
        model: 'replay-fixture',
        prompt: agentInput.prompt,
        inputDigests: [{ path: 'src/toolkit.ts', algorithm: 'sha256' as const, value: 'a'.repeat(64) }]
      };
      expect(deriveAgentCacheKey(cacheKeyInput)).toMatch(/^[a-f0-9]{64}$/);

      let runs = 0;
      const first = await runCachedAgentStep({
        cacheDir: dir,
        cacheKeyInput,
        async run() {
          runs += 1;
          return agentResult;
        }
      });
      const second = await runCachedAgentStep({
        cacheDir: dir,
        cacheKeyInput,
        async run() {
          runs += 1;
          return agentResult;
        }
      });

      expect(first.hit).toBe(false);
      expect(second.hit).toBe(true);
      expect(runs).toBe(1);
      expect(second.result).toEqual(agentResult);
    });
  });

  it('persists redacted transcripts without storing secrets', async () => {
    await withTempDir(async (dir) => {
      const path = await writeAgentTranscript({
        runDir: dir,
        stepId: 'writer-overview',
        input: agentInput,
        result: agentResult
      });
      const transcript = await readFile(path, 'utf8');
      expect(transcript).toContain('[REDACTED]');
      expect(transcript).not.toContain('sk-123456789012345678901234');
      expect(transcript).not.toContain('do-not-store');
      expect(transcript).not.toContain('top-secret');
    });
  });
});

describe('changelog and FAQ guidance', () => {
  it('generates changelog entries grounded only in git diff facts', () => {
    const diff = [
      'diff --git a/src/toolkit.ts b/src/toolkit.ts',
      '--- a/src/toolkit.ts',
      '+++ b/src/toolkit.ts',
      '@@ -1,2 +1,3 @@',
      '-export const oldName = "Acme";',
      '+export const toolkitName = "Acme";',
      '+export const version = "1.0.0";',
      'diff --git a/README.md b/README.md',
      '--- a/README.md',
      '+++ b/README.md',
      '@@ -4,1 +4,1 @@',
      '-Old docs',
      '+New docs'
    ].join('\n');

    expect(generateChangelogFromDiff(diff)).toEqual([
      {
        path: 'src/toolkit.ts',
        additions: 2,
        deletions: 1,
        sourceDiffHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        summary: 'src/toolkit.ts: 2 additions, 1 deletions'
      },
      {
        path: 'README.md',
        additions: 1,
        deletions: 1,
        sourceDiffHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        summary: 'README.md: 1 additions, 1 deletions'
      }
    ]);
  });

  it('creates FAQ/AEO guidance that forbids unsupported answers', () => {
    expect(
      createFaqAeoWriterGuidance({
        pageTitle: 'Overview',
        facts: ['The CLI command is docstube generate.', 'The output is a static Astro docs site.']
      })
    ).toContain('omit it instead of guessing');
  });
});
