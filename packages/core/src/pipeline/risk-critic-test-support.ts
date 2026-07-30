import type { AgentTaskSpec, RiskCriticFinding, Transcript } from '@docstube/contracts';

// Scripted risk-critic answers for tests. CI never calls a live model (CLAUDE.md), and the critic
// now runs once on every page, so every scripted runner in the suite needs a way to answer
// `assess-page-risk` — otherwise the call falls through to whatever branch handles write-page and
// silently eats a queued response.
//
// The DEFAULT is the clean page: a completed verdict with no findings. That is the honest baseline
// for tests about something else, and it is also the answer the critic is supposed to give most of
// the time (see the "reporting nothing is a correct answer" rule in the prompt).

export const cleanRiskCriticTranscript = (
  spec: AgentTaskSpec,
  findings: readonly RiskCriticFinding[] = []
): Transcript => ({
  schemaVersion: 1,
  taskId: spec.id,
  cacheKey: 'test',
  transport: 'replay',
  model: 'scripted',
  turns: [],
  observedReads: [],
  usage: { inputTokens: 1, outputTokens: 1, cacheHit: false },
  stopReason: 'complete',
  result: {
    type: 'structured',
    value: {
      findings: findings.map((finding) => ({
        kind: finding.kind,
        anchorId: finding.anchor.kind === 'block' ? finding.anchor.blockId : finding.anchor.claimId,
        severity: finding.severity,
        message: finding.message,
        rationale: finding.rationale
      }))
    }
  }
});
