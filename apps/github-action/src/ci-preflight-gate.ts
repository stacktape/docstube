import { ciPreflightReportSchema } from '@docstube/contracts';
import type { CiPreflightReport } from '@docstube/contracts';

// THE PREFLIGHT GATE (quality-ci-reader-v2 decision 14). The Action runs `docstube doctor --ci
// --json` FIRST and reads the versioned report. A blocking failure aborts the job before the
// generate step, so a missing credential or an unusable token costs zero model spend instead of
// being discovered after the run has already billed.
//
// This is a preflight IN FRONT OF the PublicationDecision gate, never a replacement for it: it
// says "this run can succeed", the decision says "this candidate may merge".
//
// The Action runs the user's PINNED CLI, which may predate this command. An unparseable or
// missing report is therefore UNAVAILABLE, not a pass and not a failure — the caller degrades to
// the legacy environment credential check and says so.

export type PreflightRunResult = { exitCode: number; stdout: string; stderr: string };

export type PreflightOutcome =
  | { kind: 'pass'; report: CiPreflightReport }
  | { kind: 'blocked'; report: CiPreflightReport }
  | { kind: 'unavailable'; reason: string };

// npx and the runner both write to the same stream, so the report is extracted rather than assumed
// to be the entire stdout.
export const parseCiPreflightReport = (
  stdout: string
): { ok: true; report: CiPreflightReport } | { ok: false; reason: string } => {
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start === -1 || end <= start) {
    return { ok: false, reason: 'the preflight produced no JSON report' };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(stdout.slice(start, end + 1));
  } catch (error) {
    return { ok: false, reason: `the preflight report is not readable JSON: ${(error as Error).message}` };
  }
  const parsed = ciPreflightReportSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      reason: `the preflight report does not satisfy the contract this Action understands: ${parsed.error.message.slice(0, 400)}`
    };
  }
  return { ok: true, report: parsed.data };
};

export const evaluateCiPreflight = (result: PreflightRunResult): PreflightOutcome => {
  const parsed = parseCiPreflightReport(result.stdout);
  if (!parsed.ok) {
    const detail = (result.stderr || result.stdout).trim().split(/\r?\n/g).slice(-3).join(' ').slice(0, 300);
    return {
      kind: 'unavailable',
      reason: `${parsed.reason} (exit ${result.exitCode}${detail ? `: ${detail}` : ''}). The pinned docstube CLI may predate \`doctor --ci --json\`.`
    };
  }
  return parsed.report.ok ? { kind: 'pass', report: parsed.report } : { kind: 'blocked', report: parsed.report };
};

const statusIcon: Record<CiPreflightReport['checks'][number]['status'], string> = {
  pass: 'ok',
  fail: '**FAIL**',
  warn: 'warn',
  unknown: 'unknown'
};

export const renderCiPreflightSummary = (report: CiPreflightReport): string => {
  const lines = [
    '## docstube preflight',
    '',
    report.ok
      ? 'Every blocking preflight check passed.'
      : 'docstube stopped BEFORE generating anything, so this run spent nothing on models. Fix the failing checks below and re-run.',
    '',
    `Automation mode: **${report.automationMode}** — ${report.automationReason}`,
    '',
    '| Check | Status | Detail |',
    '| --- | --- | --- |'
  ];
  for (const check of report.checks) {
    lines.push(`| ${check.title} | ${statusIcon[check.status]} | ${check.detail.replaceAll('|', '\\|')} |`);
  }
  const remedies = report.checks.filter((check) => check.status === 'fail' && check.remedy !== undefined);
  if (remedies.length > 0) {
    lines.push('', '### How to fix', '');
    for (const check of remedies) {
      lines.push(`- **${check.title}**: ${check.remedy}`);
    }
  }
  return lines.join('\n');
};
