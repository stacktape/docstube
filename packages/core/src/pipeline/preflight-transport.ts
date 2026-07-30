import { runAgentTask } from '@docstube/agent-runtime';
import type { AgentTaskSpec, DocstubeConfig, Transcript } from '@docstube/contracts';
import { idPrefixes, mintId } from '@docstube/contracts';
import { createTransportFromConfig } from './task-runner.ts';

// TRANSPORT PREFLIGHT (PRODUCT §3.9.2 phase 2, dx-knowledge-v2 decision 2). One tiny real call
// against the chosen provider before setup commits anything, so "your API key is wrong" lands in
// setup rather than forty minutes into a generation run.
//
// It is a LIVE call by construction — there is nothing to prove otherwise — so it is opt-out and
// never runs on a CI or test path: `shouldSkipPreflight` short-circuits it before any transport is
// constructed, and every spec injects `runTask` instead.

export const preflightTaskSpec = (): AgentTaskSpec => ({
  id: mintId(idPrefixes.task),
  kind: 'preflight',
  systemPrompt: 'You are a connectivity check. Answer with exactly one word.',
  userPrompt: 'Reply with the single word: ok',
  tools: [],
  workspace: { readRoots: ['.'], writableRoots: [] },
  budget: { maxTurns: 1, maxToolCalls: 0 },
  output: { type: 'text' }
});

export type PreflightResult = {
  ok: boolean;
  // 'skipped' when the environment forbids live calls; the caller must not treat it as a pass.
  skipped: boolean;
  transport: string;
  model: string;
  detail: string;
};

export const preflightSkipReason = (env: NodeJS.ProcessEnv = process.env): string | undefined => {
  if (env.DOCSTUBE_SKIP_PREFLIGHT === '1' || env.DOCSTUBE_SKIP_PREFLIGHT === 'true') {
    return 'DOCSTUBE_SKIP_PREFLIGHT is set';
  }
  if (env.VITEST !== undefined || env.NODE_ENV === 'test') {
    return 'running under the test runner';
  }
  if (env.CI !== undefined && env.CI !== '' && env.CI !== 'false') {
    return 'running in CI';
  }
  return undefined;
};

export type PreflightInput = {
  repoRoot: string;
  config: DocstubeConfig;
  env?: NodeJS.ProcessEnv;
  // Tests and the record/replay path substitute the live call entirely.
  runTask?: (spec: AgentTaskSpec) => Promise<Transcript>;
};

export const runTransportPreflight = async (input: PreflightInput): Promise<PreflightResult> => {
  const env = input.env ?? process.env;
  const spec = preflightTaskSpec();

  if (input.runTask === undefined) {
    const skip = preflightSkipReason(env);
    if (skip !== undefined) {
      return {
        ok: true,
        skipped: true,
        transport: input.config.agents.transport,
        model: input.config.agents.model ?? '(default)',
        detail: `preflight skipped — ${skip}`
      };
    }
  }

  let transportId = input.config.agents.transport as string;
  let model = input.config.agents.model ?? '(default)';
  try {
    let transcript: Transcript;
    if (input.runTask === undefined) {
      const resolved = createTransportFromConfig(input.config, input.repoRoot, env);
      transportId = resolved.transport.id;
      model = resolved.model;
      // No cache: a cached transcript proves the credential worked once, not that it works now.
      transcript = await runAgentTask(spec, {
        transport: resolved.transport,
        model: resolved.model,
        repoRoot: input.repoRoot
      });
    } else {
      transcript = await input.runTask(spec);
      transportId = transcript.transport;
      model = transcript.model;
    }
    if (transcript.stopReason === 'error') {
      return {
        ok: false,
        skipped: false,
        transport: transportId,
        model,
        detail: transcript.error ?? 'transport error'
      };
    }
    return { ok: true, skipped: false, transport: transportId, model, detail: `${transportId} answered` };
  } catch (error) {
    return { ok: false, skipped: false, transport: transportId, model, detail: (error as Error).message };
  }
};
