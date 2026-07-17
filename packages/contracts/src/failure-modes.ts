// Coarse failure-mode codes for telemetry: a FIXED registry, never free text. Telemetry payloads
// may contain ONLY these codes plus counts — which failure modes dominate, with zero sensitive
// content. Extend the registry deliberately; never pass an arbitrary string through.

export const failureModeCodes = [
  'transport.rate-limited',
  'transport.timeout',
  'transport.error',
  'write.no-mdx',
  'write.frontmatter-invalid',
  'verify.snippet-failed',
  'verify.typecheck-failed',
  'verify.links-broken',
  'verify.mdx-compile-failed',
  'verify.d2-failed',
  'claims.ungrounded',
  'gate.exhausted',
  'review.error',
  'translate.structure-mismatch',
  'run.frozen-budget',
  'other'
] as const;
export type FailureModeCode = (typeof failureModeCodes)[number];

// Finding `check` ids (verifier ids / review criterion ids) → registry codes.
const checkToCode: Record<string, FailureModeCode> = {
  'snippet-exec': 'verify.snippet-failed',
  'code-typecheck-ts': 'verify.typecheck-failed',
  'code-typecheck-py': 'verify.typecheck-failed',
  'internal-links': 'verify.links-broken',
  'mdx-compile': 'verify.mdx-compile-failed',
  'diagram-d2': 'verify.d2-failed',
  'claim-grounding': 'claims.ungrounded',
  'review-error': 'review.error',
  'translation-structure': 'translate.structure-mismatch'
};

// Flag kinds → registry codes. A 'system' flag means the gate exhausted its retries (or a
// system-level failure escalated past it); everything else has no dedicated code yet.
const flagKindToCode: Record<string, FailureModeCode> = {
  system: 'gate.exhausted'
};

// Harness/transport error kinds → registry codes.
const errorKindToCode: Record<string, FailureModeCode> = {
  'rate-limited': 'transport.rate-limited',
  timeout: 'transport.timeout',
  'transport-error': 'transport.error',
  'no-mdx': 'write.no-mdx',
  'frontmatter-invalid': 'write.frontmatter-invalid',
  'frozen-budget': 'run.frozen-budget'
};

export const toFailureModeCode = (input: {
  check?: string | undefined;
  flagKind?: string | undefined;
  errorKind?: string | undefined;
}): FailureModeCode => {
  if (input.check !== undefined) {
    return checkToCode[input.check] ?? 'other';
  }
  if (input.flagKind !== undefined) {
    return flagKindToCode[input.flagKind] ?? 'other';
  }
  if (input.errorKind !== undefined) {
    return errorKindToCode[input.errorKind] ?? 'other';
  }
  return 'other';
};
