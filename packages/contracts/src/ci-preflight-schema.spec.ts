import { describe, expect, it } from 'vitest';
import { ciPreflightReportSchema } from './ci-preflight-schema.ts';
import type { CiPreflightCheck } from './ci-preflight-schema.ts';

const check = (overrides: Partial<CiPreflightCheck> & Pick<CiPreflightCheck, 'id'>): CiPreflightCheck => ({
  title: 'fixture check',
  status: 'pass',
  blocking: false,
  detail: 'fixture detail',
  ...overrides
});

const report = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  toolVersion: '0.0.2',
  generatedAt: '2026-07-29T00:00:00.000Z',
  mode: 'ci',
  automationMode: 'approval-assisted',
  automationReason: 'the workflow token is a GitHub App installation token.',
  checks: [check({ id: 'node-runtime', blocking: true })],
  ok: true,
  fatal: [],
  ...overrides
});

describe('ci preflight report schema', () => {
  it('parses a clean report', () => {
    expect(ciPreflightReportSchema.safeParse(report()).success).toBe(true);
  });

  it('rejects a report whose fatal list disagrees with its failed blocking checks', () => {
    const parsed = ciPreflightReportSchema.safeParse(
      report({
        checks: [check({ id: 'transport-credential', blocking: true, status: 'fail' })],
        ok: false,
        fatal: []
      })
    );
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain('fatal must list exactly the blocking checks that failed');
  });

  it('rejects ok:true when a blocking check failed', () => {
    const parsed = ciPreflightReportSchema.safeParse(
      report({
        checks: [check({ id: 'transport-credential', blocking: true, status: 'fail' })],
        ok: true,
        fatal: ['transport-credential']
      })
    );
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain('ok must be true exactly when no blocking check failed');
  });

  it('never lets an unknown check turn fatal — unknown is reported, not enforced', () => {
    const parsed = ciPreflightReportSchema.safeParse(
      report({
        checks: [check({ id: 'github-repository-write', blocking: true, status: 'unknown' })],
        ok: true,
        fatal: []
      })
    );
    expect(parsed.success).toBe(true);
  });

  it('refuses to claim full-auto while an auto-merge precondition is unproven', () => {
    const parsed = ciPreflightReportSchema.safeParse(
      report({
        automationMode: 'full-auto',
        automationReason: 'wishful thinking',
        checks: [
          check({ id: 'auto-merge-repository', status: 'pass' }),
          check({ id: 'auto-merge-branch-policy', status: 'unknown' }),
          check({ id: 'auto-merge-token-mode', status: 'pass' })
        ]
      })
    );
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain('auto-merge-branch-policy=unknown');
  });

  it('rejects a duplicated check id', () => {
    const parsed = ciPreflightReportSchema.safeParse(
      report({ checks: [check({ id: 'node-runtime' }), check({ id: 'node-runtime' })] })
    );
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain('duplicate check id');
  });
});
