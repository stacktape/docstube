import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseGoldEvalSet, runDeterministicEvals, runEvalFile, scoreCandidate } from './run-evals.ts';

const goldSetPath = fileURLToPath(new URL('../../evals/gold-set.json', import.meta.url));

describe('deterministic eval runner', () => {
  it('scores required and forbidden evidence deterministically', () => {
    expect(
      scoreCandidate('Use the committed manifest and deterministic verifiers.', {
        mustContain: ['committed manifest', 'deterministic verifiers'],
        mustNotContain: ['sk-']
      })
    ).toMatchObject({ label: 'pass', score: 1 });

    expect(
      scoreCandidate('Use a secret sk-test token.', {
        mustContain: ['secret'],
        mustNotContain: ['sk-test']
      })
    ).toMatchObject({ forbidden: ['sk-test'], label: 'fail' });
  });

  it('passes the checked-in gold set with judge-vs-human agreement and comparisons', async () => {
    const goldSet = parseGoldEvalSet(JSON.parse(await readFile(goldSetPath, 'utf8')));
    const result = runDeterministicEvals(goldSet);

    expect(result.ok).toBe(true);
    expect(result.summary).toMatchObject({
      agreementRate: 1,
      failed: 0,
      live: false,
      passed: 4,
      total: 4
    });
    expect(result.cases.map((testCase) => testCase.kind)).toContain('context-ablation');
    expect(result.cases.map((testCase) => testCase.kind)).toContain('skill-comparison');
  });

  it('fails agreement when the deterministic judge and human label diverge', async () => {
    const goldSet = parseGoldEvalSet(JSON.parse(await readFile(goldSetPath, 'utf8')));
    const first = goldSet.cases[0]!;
    if (first.kind !== 'judge-vs-human') {
      throw new Error('Expected first fixture case to be judge-vs-human.');
    }
    const result = runDeterministicEvals({
      ...goldSet,
      cases: [{ ...first, humanLabel: 'fail' }, ...goldSet.cases.slice(1)]
    });

    expect(result.ok).toBe(false);
    expect(result.summary.agreementRate).toBeLessThan(1);
  });

  it('writes eval output and keeps live mode secrets-gated', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'docstube-evals-'));
    try {
      const outputPath = join(dir, 'latest.json');
      await expect(runEvalFile({ goldSetPath, outputPath })).resolves.toMatchObject({ ok: true });
      expect(JSON.parse(await readFile(outputPath, 'utf8'))).toMatchObject({ ok: true });

      await expect(runEvalFile({ goldSetPath, live: true, outputPath: join(dir, 'live.json') })).rejects.toThrow(
        'Live evals require'
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
