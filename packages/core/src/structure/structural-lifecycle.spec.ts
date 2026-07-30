import { describe, expect, it } from 'vitest';
import type { StructuralFinding } from '@docstube/contracts';
import { buildFixtureStructuralFinding, contentHashSchema, structuralScopeKey } from '@docstube/contracts';
import { reconcileStructuralFindings } from './structural-lifecycle.ts';

const finding = (overrides: Partial<StructuralFinding> = {}): StructuralFinding => ({
  ...buildFixtureStructuralFinding(),
  ...overrides
});

const groupScope = (base: StructuralFinding): string => structuralScopeKey(base.scope);

describe('structural finding lifecycle', () => {
  it('collapses a re-detected defect onto the same record instead of accumulating duplicates', () => {
    const base = finding();
    const reconciled = reconcileStructuralFindings({
      prior: [base],
      fresh: [base],
      evaluatedScopeKeys: [groupScope(base)]
    });
    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]?.status).toEqual({ state: 'open' });
  });

  it('auto-resolves ONLY after the same scope was re-evaluated', () => {
    const base = finding();
    const untouched = reconcileStructuralFindings({ prior: [base], fresh: [], evaluatedScopeKeys: [] });
    expect(untouched[0]?.status).toEqual({ state: 'open' });

    const reevaluated = reconcileStructuralFindings({
      prior: [base],
      fresh: [],
      evaluatedScopeKeys: [groupScope(base)]
    });
    expect(reevaluated[0]?.status).toEqual({ state: 'resolved' });
  });

  it('keeps a suppression while the scope fingerprint holds', () => {
    const base = finding();
    const suppressed = finding({
      status: {
        state: 'suppressed',
        reason: 'this section is intentionally absent',
        scopeFingerprint: base.scopeFingerprint
      }
    });
    const reconciled = reconcileStructuralFindings({
      prior: [suppressed],
      fresh: [base],
      evaluatedScopeKeys: [groupScope(base)]
    });
    expect(reconciled[0]?.status.state).toBe('suppressed');
  });

  it('reopens a suppression when the scope materially changed', () => {
    const base = finding();
    const suppressed = finding({
      status: { state: 'suppressed', reason: 'intentional', scopeFingerprint: contentHashSchema.parse('b'.repeat(64)) }
    });
    const reconciled = reconcileStructuralFindings({
      prior: [suppressed],
      fresh: [base],
      evaluatedScopeKeys: [groupScope(base)]
    });
    expect(reconciled[0]?.status).toEqual({ state: 'open' });
  });

  it('resolves a suppressed finding whose condition is gone — no dead exemptions left behind', () => {
    const suppressed = finding({
      status: { state: 'suppressed', reason: 'intentional', scopeFingerprint: contentHashSchema.parse('b'.repeat(64)) }
    });
    const reconciled = reconcileStructuralFindings({
      prior: [suppressed],
      fresh: [],
      evaluatedScopeKeys: [groupScope(suppressed)]
    });
    expect(reconciled[0]?.status).toEqual({ state: 'resolved' });
  });

  it('orders by key so committed state is byte-stable', () => {
    const a = finding({ key: 'aaa' });
    const b = finding({ key: 'bbb' });
    expect(reconcileStructuralFindings({ prior: [], fresh: [b, a], evaluatedScopeKeys: [] }).map((f) => f.key)).toEqual(
      ['aaa', 'bbb']
    );
  });
});
