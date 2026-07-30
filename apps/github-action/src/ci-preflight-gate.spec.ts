import { describe, expect, it } from 'vitest';
import { evaluateCiPreflight, parseCiPreflightReport, renderCiPreflightSummary } from './ci-preflight-gate.ts';
import { buildFixturePreflightReport } from './test-support.ts';

const stdoutOf = (report: unknown): string => `npm notice noise\n${JSON.stringify(report, null, 2)}\n`;

describe('CI preflight gate', () => {
  it('extracts the report even when the runner wrote noise around it', () => {
    const report = buildFixturePreflightReport();
    const parsed = parseCiPreflightReport(stdoutOf(report));
    expect(parsed).toMatchObject({ ok: true });
  });

  it('passes when no blocking check failed', () => {
    const outcome = evaluateCiPreflight({ exitCode: 0, stdout: stdoutOf(buildFixturePreflightReport()), stderr: '' });
    expect(outcome.kind).toBe('pass');
  });

  it('blocks when a blocking check failed', () => {
    const report = buildFixturePreflightReport({
      checks: [
        {
          id: 'transport-credential',
          title: 'transport credential',
          status: 'fail',
          blocking: true,
          detail: 'ANTHROPIC_API_KEY is not set',
          remedy: 'Pass ANTHROPIC_API_KEY via env: from a repository secret.'
        }
      ]
    });
    const outcome = evaluateCiPreflight({ exitCode: 1, stdout: stdoutOf(report), stderr: '' });
    expect(outcome.kind).toBe('blocked');
    if (outcome.kind !== 'blocked') {
      throw new Error('expected blocked');
    }
    expect(outcome.report.fatal).toEqual(['transport-credential']);
  });

  it('treats an unparseable report as UNAVAILABLE — never as a pass', () => {
    const outcome = evaluateCiPreflight({
      exitCode: 1,
      stdout: 'error: unknown option --ci',
      stderr: 'Unknown command: doctor --ci'
    });
    expect(outcome.kind).toBe('unavailable');
    if (outcome.kind !== 'unavailable') {
      throw new Error('expected unavailable');
    }
    expect(outcome.reason).toContain('may predate');
  });

  it('treats a report from a newer, unrecognized contract as UNAVAILABLE', () => {
    const outcome = evaluateCiPreflight({
      exitCode: 0,
      stdout: JSON.stringify({ schemaVersion: 1, checks: [{ id: 'something-new', status: 'pass' }] }),
      stderr: ''
    });
    expect(outcome.kind).toBe('unavailable');
  });

  it('renders a job summary that states the zero-spend fact and every remedy', () => {
    const summary = renderCiPreflightSummary(
      buildFixturePreflightReport({
        checks: [
          {
            id: 'github-repository-write',
            title: 'github write access',
            status: 'fail',
            blocking: true,
            detail: 'the token cannot write to the repository',
            remedy: 'Add `permissions: contents: write` to the workflow job.'
          }
        ],
        automationMode: 'manual',
        automationReason: 'the repository does not allow auto-merge.'
      })
    );
    expect(summary).toContain('spent nothing on models');
    expect(summary).toContain('Automation mode: **manual**');
    expect(summary).toContain('permissions: contents: write');
  });
});
