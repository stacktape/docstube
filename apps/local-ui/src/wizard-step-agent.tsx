import { useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { describeMutationError, useTrpc } from './trpc-client.ts';
import type { StepProps } from './wizard-steps.tsx';
import { StepHeading, fieldClasses } from './wizard-steps.tsx';
import { transportsWithDefaultModel } from './wizard-state.ts';

// Provider selection (PRODUCT §3.9.2 phase 2, dx-knowledge-v2 decision 2). Detection is
// deterministic — installed CLIs and credential env-var NAMES, never a credential value. Exactly
// one viable provider is preselected WITH its reason shown; several stay an explicit choice,
// because docstube never silently ranks one subscription or API over another.

export function AgentStep({ state, dispatch }: StepProps) {
  const trpc = useTrpc();

  const providersQuery = useQuery({
    queryKey: ['setup-providers'],
    queryFn: () => trpc.setup.providers.query(),
    retry: false
  });

  const candidates = providersQuery.data?.candidates ?? [];
  const preselected = providersQuery.data?.preselected ?? null;
  const chosen = candidates.find((candidate) => candidate.transport === state.agent.transport);

  // Sole viable provider becomes the choice; the rationale next to it says why.
  const transport = state.agent.transport;
  useEffect(() => {
    if (transport !== undefined || preselected === null) {
      return;
    }
    const candidate = candidates.find((entry) => entry.transport === preselected);
    dispatch({
      type: 'set-transport',
      transport: preselected,
      ...(candidate?.defaultModel === undefined ? {} : { model: candidate.defaultModel }),
      ...(candidate?.apiKeyEnv === undefined ? {} : { apiKeyEnv: candidate.apiKeyEnv })
    });
  }, [transport, preselected, candidates, dispatch]);

  const preflightMutation = useMutation({
    mutationFn: () => trpc.setup.preflight.mutate(),
    onSuccess: (result) => dispatch({ type: 'set-preflight', result: { ok: result.ok, detail: result.detail } })
  });

  const viableCount = candidates.filter((candidate) => candidate.viable).length;

  return (
    <div className="space-y-4">
      <StepHeading
        title="Agent provider"
        hint="docstube runs on your own coding agent or API key. Detected from installed CLIs and credential environment variables — the credential itself is never read or stored."
      />
      {providersQuery.isPending && <p className="text-sm text-neutral-400">Detecting providers…</p>}
      {providersQuery.isError && (
        <p role="alert" className="text-sm text-rose-300">
          Provider detection failed: {String(providersQuery.error)}
        </p>
      )}
      {providersQuery.isSuccess && viableCount === 0 && (
        <p className="rounded border border-amber-900/60 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
          No provider is ready yet — install the Claude or Codex CLI, or export an API key, then reload.
        </p>
      )}
      <div className="space-y-2">
        {candidates.map((candidate) => {
          const selected = state.agent.transport === candidate.transport;
          return (
            <button
              key={candidate.transport}
              type="button"
              aria-pressed={selected}
              disabled={!candidate.viable}
              onClick={() =>
                dispatch({
                  type: 'set-transport',
                  transport: candidate.transport,
                  ...(candidate.defaultModel === undefined ? {} : { model: candidate.defaultModel }),
                  ...(candidate.apiKeyEnv === undefined ? {} : { apiKeyEnv: candidate.apiKeyEnv })
                })
              }
              className={`flex w-full items-baseline justify-between gap-3 rounded-lg border p-3 text-left disabled:opacity-40 ${
                selected ? 'border-neutral-300 bg-neutral-900' : 'border-neutral-800 hover:border-neutral-600'
              }`}
            >
              <span className="text-sm font-medium text-neutral-100">{candidate.label}</span>
              <span className="text-xs text-neutral-400">{candidate.reason}</span>
            </button>
          );
        })}
      </div>
      {preselected !== null && state.agent.transport === preselected && (
        <p className="text-xs text-neutral-500">Only one provider is ready here, so it is preselected.</p>
      )}

      {chosen !== undefined && (
        <div className="space-y-3 rounded border border-neutral-800 p-4">
          <label className="block space-y-1">
            <span className="text-xs text-neutral-400">
              Model{transportsWithDefaultModel.includes(chosen.transport) ? ' (optional)' : ' (required)'}
            </span>
            <input
              aria-label="Agent model"
              className={fieldClasses}
              value={state.agent.model}
              placeholder={chosen.defaultModel ?? 'e.g. gpt-5'}
              onChange={(event) => dispatch({ type: 'set-agent-field', field: 'model', value: event.target.value })}
            />
          </label>
          {chosen.apiKeyEnv !== undefined && (
            <label className="block space-y-1">
              <span className="text-xs text-neutral-400">Credential environment variable (name only)</span>
              <input
                aria-label="Credential env var"
                className={fieldClasses}
                value={state.agent.apiKeyEnv}
                placeholder={chosen.apiKeyEnv}
                onChange={(event) =>
                  dispatch({ type: 'set-agent-field', field: 'apiKeyEnv', value: event.target.value })
                }
              />
            </label>
          )}
          {chosen.transport === 'openai-compatible' && (
            <label className="block space-y-1">
              <span className="text-xs text-neutral-400">Base URL (OpenAI, Ollama, or any compatible endpoint)</span>
              <input
                aria-label="Base URL"
                className={fieldClasses}
                value={state.agent.baseUrl}
                placeholder="https://api.openai.com/v1"
                onChange={(event) => dispatch({ type: 'set-agent-field', field: 'baseUrl', value: event.target.value })}
              />
            </label>
          )}
        </div>
      )}

      {chosen !== undefined && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="rounded border border-neutral-600 px-3 py-1.5 text-sm text-neutral-200 hover:border-neutral-400 disabled:opacity-50"
            disabled={preflightMutation.isPending}
            onClick={() => preflightMutation.mutate()}
          >
            {preflightMutation.isPending ? 'Checking…' : 'Test this provider'}
          </button>
          {state.preflight !== undefined && (
            <span className={`text-xs ${state.preflight.ok ? 'text-emerald-300' : 'text-rose-300'}`}>
              {state.preflight.detail}
            </span>
          )}
          {preflightMutation.error !== null && (
            <span role="alert" className="text-xs text-rose-300">
              {describeMutationError(preflightMutation.error).message}
            </span>
          )}
        </div>
      )}
      <p className="text-xs text-neutral-500">
        Generate runs this check automatically — testing here just surfaces an auth problem sooner.
      </p>
    </div>
  );
}
