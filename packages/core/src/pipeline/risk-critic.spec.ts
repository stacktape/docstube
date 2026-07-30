import { describe, expect, it } from 'vitest';
import type { AgentTaskSpec, ClaimLedger, IaPageNodeV2, PageEntity, Transcript } from '@docstube/contracts';
import {
  agentRoleByTaskKind,
  agentRoleForTaskKind,
  agentRoleSchema,
  buildFixtureClaimLedger,
  buildFixturePage,
  buildFixtureProvenanceV2,
  knownAgentTaskKinds,
  riskCriticFindingKindSchema,
  riskCriticResultSchema
} from '@docstube/contracts';
import {
  buildAssessPageRiskTask,
  buildRiskCriticSystemPrompt,
  buildRiskCriticUserPrompt,
  riskCriticCacheKey,
  riskCriticFindings,
  riskCriticFromTranscript,
  riskCriticPromptVersion,
  riskCriticSummaryLine,
  runRiskCritic
} from './risk-critic.ts';
import { createMemoryRiskCriticCache } from './risk-critic-cache.ts';
import { createRunCostTracker } from './run-cost.ts';

// THE RISK CRITIC (harness-state-v2 decision 4). What these tests pin down is not "does the model
// find the bug" — CI never calls a model — but the CONTRACT around the call: what the critic is
// fed, what it is denied, that its findings are anchored assessments, that it costs exactly one
// call per page, that it degrades honestly, and that nothing it says can move the correctness axis
// or the complete badge.

const page = (): PageEntity => buildFixturePage();

const node = (): IaPageNodeV2 => ({
  kind: 'page',
  title: 'Installation',
  slug: 'getting-started/installation',
  brief: 'How to install docstube and what it needs.',
  depth: 'standard',
  primaryPersona: 'app-developer'
});

const criticInput = (input?: { page?: PageEntity; ledger?: ClaimLedger; mdx?: string }) => {
  const target = input?.page ?? page();
  const ledger = input?.ledger ?? buildFixtureClaimLedger(target);
  return {
    mdx: input?.mdx ?? '# Installation\n\nInstall docstube with your package manager of choice.\n',
    page: target,
    ledger,
    claimEvidence: buildFixtureProvenanceV2(ledger).claimEvidence,
    node: node(),
    personaDescription: 'Builds apps on top of the library'
  };
};

const structuredTranscript = (spec: AgentTaskSpec, value: unknown): Transcript => ({
  schemaVersion: 1,
  taskId: spec.id,
  cacheKey: 'test',
  transport: 'replay',
  model: 'scripted-critic',
  turns: [],
  observedReads: [],
  usage: { inputTokens: 1, outputTokens: 1, cacheHit: false },
  stopReason: 'complete',
  result: { type: 'structured', value }
});

describe('risk-critic routing', () => {
  it('routes assess-page-risk to its own risk-critic role, and the role is real', () => {
    // ARCHITECTURE §8.2: planned roles "join the enum WITH the tasks that issue them, never
    // before". The task exists now, so the role must exist, be routable, and be reachable through
    // the closed kind→role map (an unmapped kind is a compile error by construction of the Record).
    expect(knownAgentTaskKinds).toContain('assess-page-risk');
    expect(agentRoleSchema.options).toContain('risk-critic');
    expect(agentRoleByTaskKind['assess-page-risk']).toBe('risk-critic');
    expect(agentRoleForTaskKind('assess-page-risk')).toBe('risk-critic');
  });
});

describe('the critic is fed evidence, never the repository', () => {
  it('carries NO tools and NO read roots — the whole point of the design', () => {
    const task = buildAssessPageRiskTask(criticInput());
    expect(task.kind).toBe('assess-page-risk');
    expect(task.tools).toEqual([]);
    // Giving a critic repo access is what turned persona reviews into zero-tool-call plausibility
    // theater; the workspace is empty so the harness cannot hand it one.
    expect(task.workspace.readRoots).toEqual([]);
    expect(task.workspace.writableRoots).toEqual([]);
  });

  it('hands it the page prose, the ledger with correctness and evidence kind, the linter spans, and the brief', () => {
    const target = page();
    const ledger = buildFixtureClaimLedger(target);
    const blockId = target.preamble[0]!.id;
    const withLint: ClaimLedger = {
      ...ledger,
      coverageLint: {
        uncovered: [{ blockId, excerpt: 'It always returns 2.', detector: 'identifier-with-numeric-literal' }]
      }
    };
    const prompt = buildRiskCriticUserPrompt(criticInput({ page: target, ledger: withLint }));

    expect(prompt).toContain('How to install docstube and what it needs.');
    expect(prompt).toContain('app-developer');
    expect(prompt).toContain(blockId);
    // Correctness AND the evidence backing each claim — the strength signal the critic reasons from.
    expect(prompt).toContain('retry exists');
    expect(prompt).toContain('checked');
    expect(prompt).toContain('codemap-grounding:pass');
    expect(prompt).toContain('unchecked');
    // The linter's spans ride along, marked as already counted so the critic adds to them instead
    // of restating them.
    expect(prompt).toContain('It always returns 2.');
    expect(prompt).toContain('already counted — do not repeat');
  });
});

describe('prompt and gate in lockstep', () => {
  it('teaches exactly the finding kinds the contract accepts — no more, no fewer', () => {
    // PROMPT AND GATE IN LOCKSTEP (the element-policy convention): the kind list the critic is
    // taught IS riskCriticFindingKindSchema. A kind in the prompt but not the schema is a
    // guaranteed dropped finding; a kind in the schema but not the prompt is dead contract.
    const prompt = buildRiskCriticSystemPrompt();
    for (const kind of riskCriticFindingKindSchema.options) {
      expect(prompt).toContain(`- ${kind}:`);
    }
    const taught = [...prompt.matchAll(/^- ([a-z-]+):/gmu)].map((match) => match[1]);
    expect(taught.toSorted()).toEqual([...riskCriticFindingKindSchema.options].toSorted());
  });

  it('states the rules the parser actually enforces: anchored findings, and nothing is a gate', () => {
    const prompt = buildRiskCriticSystemPrompt();
    expect(prompt).toContain('Every finding MUST carry `anchorId`');
    expect(prompt).toContain('REPORTING NOTHING IS A CORRECT AND EXPECTED ANSWER');
    expect(prompt).toContain('Nothing you report blocks publication.');
  });
});

describe('parsing a verdict', () => {
  it('turns a genuinely misleading framing into a finding anchored to the right block', () => {
    const target = page();
    const ledger = buildFixtureClaimLedger(target);
    const blockId = target.sections[0]!.blocks[0]!.id;
    const parsed = riskCriticFromTranscript({
      transcript: structuredTranscript({ id: 'tsk_x' } as AgentTaskSpec, {
        findings: [
          {
            kind: 'misleading-framing',
            anchorId: blockId,
            severity: 'error',
            message: 'The install snippet is presented as the only supported path.',
            rationale:
              'The brief says docstube supports a no-Node install, but this section frames the npm command as the install procedure.'
          }
        ]
      }),
      page: target,
      ledger
    });
    expect(parsed.completed).toBe(true);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.findings).toHaveLength(1);
    expect(parsed.findings[0]).toMatchObject({
      kind: 'misleading-framing',
      anchor: { kind: 'block', blockId },
      severity: 'error'
    });
  });

  it('anchors to a CLAIM when the critic names one', () => {
    const target = page();
    const ledger = buildFixtureClaimLedger(target);
    const claimId = ledger.claims[0]!.claimId;
    const parsed = riskCriticFromTranscript({
      transcript: structuredTranscript({ id: 'tsk_x' } as AgentTaskSpec, {
        findings: [
          {
            kind: 'wrong-emphasis',
            anchorId: claimId,
            severity: 'warning',
            message: 'A whole section rests on this one claim.',
            rationale: 'The claim is checked, but it is the only support for the surrounding argument.'
          }
        ]
      }),
      page: target,
      ledger
    });
    expect(parsed.findings[0]?.anchor).toEqual({ kind: 'claim', claimId });
  });

  it('yields NO findings for a clean page', () => {
    const target = page();
    const parsed = riskCriticFromTranscript({
      transcript: structuredTranscript({ id: 'tsk_x' } as AgentTaskSpec, { findings: [] }),
      page: target,
      ledger: buildFixtureClaimLedger(target)
    });
    expect(parsed).toMatchObject({ completed: true, findings: [], warnings: [] });
  });

  it('DROPS a finding anchored to something this page does not have', () => {
    // A work item pointing at nothing is worse than no work item: `refine` would be sent at a block
    // that does not exist. Fail quiet, and say so in a warning.
    const target = page();
    const parsed = riskCriticFromTranscript({
      transcript: structuredTranscript({ id: 'tsk_x' } as AgentTaskSpec, {
        findings: [
          {
            kind: 'dangerous-omission',
            // Well-formed block id, but not one of THIS page's blocks: the membership check, not
            // just the shape check, is what has to reject it.
            anchorId: 'bl_00000000000000000000',
            severity: 'error',
            message: 'x',
            rationale: 'y'
          }
        ]
      }),
      page: target,
      ledger: buildFixtureClaimLedger(target)
    });
    expect(parsed.findings).toEqual([]);
    expect(parsed.completed).toBe(true);
    expect(parsed.warnings[0]).toContain('is not a block or claim on this page — dropped');
  });

  it('records a non-completion instead of a clean pass when the payload is unusable', () => {
    const target = page();
    const parsed = riskCriticFromTranscript({
      transcript: {
        ...structuredTranscript({ id: 'tsk_x' } as AgentTaskSpec, { nonsense: true }),
        stopReason: 'max-turns'
      },
      page: target,
      ledger: buildFixtureClaimLedger(target)
    });
    expect(parsed.completed).toBe(false);
    expect(parsed.findings).toEqual([]);
    expect(parsed.warnings[0]).toContain('unusable verdict');
  });
});

describe('critic findings never reach the gate', () => {
  it('projects even an error-severity finding as a WARNING finding, never an error', () => {
    // `error` is the severity the deterministic gate consumes. A critic finding that reached it
    // would let a model's editorial opinion fail a page whose claims all check out.
    const result = riskCriticResultSchema.parse({
      scoredBy: 'm',
      completion: 'completed',
      promptVersion: riskCriticPromptVersion,
      findings: [
        {
          kind: 'dangerous-omission',
          anchor: { kind: 'block', blockId: page().preamble[0]!.id },
          severity: 'error',
          message: 'No warning that this deletes data.',
          rationale: 'The brief names a destructive command and the page never says it is irreversible.'
        }
      ]
    });
    const findings = riskCriticFindings(result);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('warning');
    expect(findings.some((finding) => finding.severity === 'error')).toBe(false);
    // The critic's own severity survives for repair ordering.
    expect(findings[0]?.data).toMatchObject({ criticSeverity: 'error', kind: 'dangerous-omission' });
  });

  it('refuses to record findings on a verdict that never completed', () => {
    for (const completion of ['pending', 'failed'] as const) {
      const parsed = riskCriticResultSchema.safeParse({
        scoredBy: 'm',
        completion,
        promptVersion: '1',
        findings: [
          {
            kind: 'wrong-emphasis',
            anchor: { kind: 'block', blockId: page().preamble[0]!.id },
            severity: 'info',
            message: 'x',
            rationale: 'y'
          }
        ]
      });
      expect(parsed.success).toBe(false);
    }
  });
});

describe('budget discipline', () => {
  it('bills once, then serves an unchanged page from cache with NO second call', () => {
    const cache = createMemoryRiskCriticCache();
    const input = criticInput();
    let calls = 0;
    const runTask = async (spec: AgentTaskSpec): Promise<Transcript> => {
      calls += 1;
      return structuredTranscript(spec, { findings: [] });
    };
    return (async () => {
      const first = await runRiskCritic({ critic: input, model: 'm', runTask, cache });
      expect(first).toMatchObject({ requested: true, fromCache: false });
      expect(first.result.completion).toBe('completed');
      expect(calls).toBe(1);

      // Same prose, same ledger, same prompt version, same model ⇒ the same question.
      const second = await runRiskCritic({ critic: { ...input }, model: 'm', runTask, cache });
      expect(second).toMatchObject({ requested: false, fromCache: true });
      expect(second.result.completion).toBe('completed');
      expect(calls).toBe(1);
    })();
  });

  it('re-bills when the prose, the ledger state, the model, or the brief moves — and not otherwise', () => {
    const base = criticInput();
    const key = riskCriticCacheKey({ ...base, model: 'm' });
    // Stable: recomputing over the same material is the same question.
    expect(riskCriticCacheKey({ ...base, model: 'm' })).toBe(key);

    expect(riskCriticCacheKey({ ...base, mdx: `${base.mdx}\nA new sentence.`, model: 'm' })).not.toBe(key);
    expect(riskCriticCacheKey({ ...base, model: 'other-model' })).not.toBe(key);
    expect(riskCriticCacheKey({ ...base, node: { ...base.node, brief: 'A different brief.' }, model: 'm' })).not.toBe(
      key
    );
    // Ledger state: the same prose whose claim now verifies differently is a different question.
    const flipped = {
      ...base,
      claimEvidence: base.claimEvidence.map((record, index) =>
        index === 0
          ? { ...record, correctness: 'unchecked' as const, disposition: 'no-checker-available' as const }
          : record
      )
    };
    expect(riskCriticCacheKey({ ...flipped, model: 'm' })).not.toBe(key);
    // And so is the same prose with a new uncovered span.
    const linted = {
      ...base,
      ledger: {
        ...base.ledger,
        coverageLint: { uncovered: [{ blockId: base.page.preamble[0]!.id, excerpt: 'It always returns 2.' }] }
      }
    };
    expect(riskCriticCacheKey({ ...linted, model: 'm' })).not.toBe(key);
  });
});

describe('honest degradation — never a silent pass', () => {
  it('records pending when the role resolves no model', async () => {
    const outcome = await runRiskCritic({
      critic: criticInput(),
      runTask: async () => structuredTranscript({ id: 'x' } as AgentTaskSpec, { findings: [] })
    });
    expect(outcome.result.completion).toBe('pending');
    expect(outcome.result.findings).toEqual([]);
    expect(outcome.requested).toBe(false);
    expect(outcome.warnings[0]).toContain('resolved no model');
  });

  it('records pending when the run budget froze, without touching a transport', async () => {
    const costTracker = createRunCostTracker(0.000001, undefined);
    costTracker.add({ inputTokens: 10_000_000, outputTokens: 10_000_000 }, 'writer');
    expect(costTracker.shouldFreeze()).toBe(true);
    let calls = 0;
    const outcome = await runRiskCritic({
      critic: criticInput(),
      model: 'm',
      costTracker,
      runTask: async (spec) => {
        calls += 1;
        return structuredTranscript(spec, { findings: [] });
      }
    });
    expect(calls).toBe(0);
    expect(outcome.result.completion).toBe('pending');
    expect(outcome.warnings[0]).toContain('budget froze');
  });

  it('records pending — not a clean verdict — when the transport throws', async () => {
    const outcome = await runRiskCritic({
      critic: criticInput(),
      model: 'm',
      runTask: async () => {
        throw new Error('transport exploded');
      }
    });
    expect(outcome.result.completion).toBe('pending');
    expect(outcome.result.findings).toEqual([]);
    expect(outcome.warnings[0]).toContain('transport exploded');
  });

  it('never caches a verdict that did not complete', async () => {
    const cache = createMemoryRiskCriticCache();
    const input = criticInput();
    let calls = 0;
    const runTask = async (): Promise<Transcript> => {
      calls += 1;
      throw new Error('down');
    };
    await runRiskCritic({ critic: input, model: 'm', runTask, cache });
    await runRiskCritic({ critic: { ...input }, model: 'm', runTask, cache });
    // One transport hiccup must not permanently silence a page.
    expect(calls).toBe(2);
  });
});

describe('the summary line reports floor and semantic layer together', () => {
  it('always states the deterministic count next to the critic count', () => {
    const result = riskCriticResultSchema.parse({
      scoredBy: 'm',
      completion: 'completed',
      promptVersion: riskCriticPromptVersion,
      findings: [
        {
          kind: 'unmarked-assertion',
          anchor: { kind: 'block', blockId: page().preamble[0]!.id },
          severity: 'warning',
          message: 'The client gives up after a while.',
          rationale: 'This asserts a retry limit with no identifier, so the linter cannot see it.'
        }
      ]
    });
    const line = riskCriticSummaryLine({ result, uncoveredAssertions: 2 });
    expect(line).toContain('nonblocking');
    expect(line).toContain('1 additional assertion(s) the linter cannot see');
    expect(line).toContain('2 unmarked assertion(s) detected deterministically (gates the complete badge)');
  });

  it('says pending rather than clean when there is no verdict', () => {
    const result = riskCriticResultSchema.parse({
      scoredBy: 'm',
      completion: 'pending',
      promptVersion: riskCriticPromptVersion,
      findings: []
    });
    expect(riskCriticSummaryLine({ result, uncoveredAssertions: 0 })).toContain('pending — no verdict this run');
    expect(riskCriticSummaryLine({ result: undefined, uncoveredAssertions: 0 })).toContain('not run');
  });
});
