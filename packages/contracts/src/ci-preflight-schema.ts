import { z } from 'zod';
import { isoTimestampSchema, semverSchema } from './primitives.ts';

// THE CI PREFLIGHT REPORT (quality-ci-reader-v2 decision 14, PRODUCT §3.3). `docstube doctor --ci
// --json` emits exactly one of these BEFORE any model spend; the GitHub Action parses it and
// aborts the job when a blocking check failed, so a missing credential or an unusable token costs
// nothing instead of being discovered after a generation run has already billed.
//
// The shape is a cross-version contract, exactly like the PublicationDecision: the Action runs the
// user's PINNED docstube CLI, which may be a different version than the Action itself. The check-id
// registry is therefore closed and versioned — an Action that cannot parse a newer report treats
// the preflight as UNAVAILABLE (and falls back), never as a pass.

export const ciPreflightStatusSchema = z.enum(['pass', 'fail', 'warn', 'unknown']);
export type CiPreflightStatus = z.infer<typeof ciPreflightStatusSchema>;

// Closed + versioned: a newer CLI reporting a check this Action does not know about must not parse
// as "everything the Action understands was fine".
export const ciPreflightCheckRegistryVersion = 1;
export const ciPreflightCheckIdSchema = z.enum([
  'node-runtime',
  'git-binary',
  'language-toolchain',
  'project-detection',
  'config-family',
  'transport-resolution',
  'transport-credential',
  'github-context',
  'github-repository-write',
  'github-pull-requests',
  'github-issues',
  'auto-merge-repository',
  'auto-merge-branch-policy',
  'auto-merge-token-mode',
  'branch-state'
]);
export type CiPreflightCheckId = z.infer<typeof ciPreflightCheckIdSchema>;

// The honest label for what this repository + token combination can actually do (decision 14):
// full-auto requires a GitHub App/PAT plus a supported branch policy; a plain GITHUB_TOKEN opens
// PRs that GitHub will not run workflows for without approval, so that mode is approval-assisted.
export const ciAutomationModeSchema = z.enum(['full-auto', 'approval-assisted', 'manual', 'unknown']);
export type CiAutomationMode = z.infer<typeof ciAutomationModeSchema>;

export const ciPreflightCheckSchema = z.strictObject({
  id: ciPreflightCheckIdSchema,
  // Short human label; the CLI's plain-text renderer and the Action's job summary print it.
  title: z.string().min(1),
  status: ciPreflightStatusSchema,
  // Whether a FAILED status on this check aborts the run before any model spend. `unknown` is
  // never fatal — an unperformable check is reported as unknown with its reason, never as a pass
  // and never as a hard stop.
  blocking: z.boolean(),
  detail: z.string().min(1),
  remedy: z.string().min(1).optional()
});
export type CiPreflightCheck = z.infer<typeof ciPreflightCheckSchema>;

export const ciPreflightReportSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    toolVersion: semverSchema,
    generatedAt: isoTimestampSchema,
    // 'ci' ran the full CI preflight (transport + GitHub); 'local' ran only the local checks.
    mode: z.enum(['ci', 'local']),
    automationMode: ciAutomationModeSchema,
    // Always stated, so the mode is never a bare label the reader has to interpret.
    automationReason: z.string().min(1),
    checks: z.array(ciPreflightCheckSchema).min(1),
    ok: z.boolean(),
    // Exactly the blocking checks that failed. Derived, but carried explicitly so a consumer never
    // has to re-derive the gate.
    fatal: z.array(ciPreflightCheckIdSchema).default([])
  })
  .superRefine((report, ctx) => {
    const seen = new Set<string>();
    for (const check of report.checks) {
      if (seen.has(check.id)) {
        ctx.addIssue({ code: 'custom', path: ['checks'], message: `duplicate check id "${check.id}"` });
      }
      seen.add(check.id);
    }
    const expectedFatal = report.checks
      .filter((check) => check.blocking && check.status === 'fail')
      .map((check) => check.id)
      .toSorted();
    if (JSON.stringify(report.fatal.toSorted()) !== JSON.stringify(expectedFatal)) {
      ctx.addIssue({
        code: 'custom',
        path: ['fatal'],
        message: `fatal must list exactly the blocking checks that failed (${expectedFatal.join(', ') || 'none'})`
      });
    }
    if (report.ok !== (expectedFatal.length === 0)) {
      ctx.addIssue({ code: 'custom', path: ['ok'], message: 'ok must be true exactly when no blocking check failed' });
    }
    // THE HONESTY INVARIANT (decision 14): full-auto is only ever claimed on evidence. A repository
    // that does not allow auto-merge, a branch policy that could not be read, or a token whose
    // PRs will not trigger workflows all forbid the label — an unknown never rounds up.
    const autoMergeGates = new Set<CiPreflightCheckId>([
      'auto-merge-repository',
      'auto-merge-branch-policy',
      'auto-merge-token-mode'
    ]);
    const unproven = report.checks.filter((check) => autoMergeGates.has(check.id) && check.status !== 'pass');
    if (report.automationMode === 'full-auto' && unproven.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['automationMode'],
        message: `full-auto requires every auto-merge precondition to pass (${unproven.map((check) => `${check.id}=${check.status}`).join(', ')})`
      });
    }
  });
export type CiPreflightReport = z.infer<typeof ciPreflightReportSchema>;
