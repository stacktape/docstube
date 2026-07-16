import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { agentRunnerHint, describeMutationError, useTrpc } from './trpc-client.ts';
import type { StepProps } from './wizard-steps.tsx';
import { StepHeading, fieldClasses } from './wizard-steps.tsx';
import type { RunMode } from '../../../packages/core/src/server/trpc-router.ts';
import {
  allIssues,
  buildConfigInput,
  buildConfigUpdates,
  buildIa,
  countIaNodes,
  iaChanged,
  wizardStepIds,
  wizardStepTitles
} from './wizard-state.ts';

// Step 10 (PRODUCT §3.9.2): summary + start. Scaffold mode writes docstube.yml + ia.yml and kicks
// off the first generate run; edit mode writes comment-preserving config diffs + the IA, then
// offers a run. Both paths land on the dashboard — the waiting room is the review room.

type StartStepProps = StepProps & { onComplete: () => void };

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 text-sm">
      <dt className="w-44 shrink-0 text-neutral-500">{label}</dt>
      <dd className="text-neutral-200">{value}</dd>
    </div>
  );
}

export function StartStep({ state, dispatch, onComplete }: StartStepProps) {
  const trpc = useTrpc();
  const [runMode, setRunMode] = useState<RunMode>(state.mode === 'scaffold' ? 'generate' : 'refresh');
  const issues = allIssues(state);

  // Scaffold mode: write the config family first; starting the run is a separate step so a
  // missing run launcher leaves the scaffolded files intact and visible.
  const scaffoldMutation = useMutation({
    mutationFn: () =>
      trpc.setup.scaffold.mutate({
        config: buildConfigInput(state),
        ia: buildIa(state) as unknown as Record<string, unknown>
      })
  });
  const saveMutation = useMutation({
    mutationFn: async () => {
      const updates = buildConfigUpdates(state);
      if (updates.length > 0) {
        await trpc.config.update.mutate({ updates });
      }
      if (iaChanged(state)) {
        await trpc.ia.update.mutate({ ia: buildIa(state) });
      }
      return { configUpdates: updates.length, iaWritten: iaChanged(state) };
    }
  });
  const startRunMutation = useMutation({
    mutationFn: (mode: RunMode) => trpc.runs.start.mutate({ mode }),
    onSuccess: () => onComplete()
  });

  const startScaffoldFlow = async () => {
    await scaffoldMutation.mutateAsync();
    startRunMutation.mutate('generate');
  };

  const sourcesSummary =
    [
      ...(state.openapi.length > 0 ? [`${state.openapi.length} OpenAPI`] : []),
      ...(state.asyncapi.length > 0 ? [`${state.asyncapi.length} AsyncAPI`] : []),
      ...(state.imports.length > 0 ? [`${state.imports.length} import(s)`] : [])
    ].join(' · ') || 'code only';
  const tokensSet = Object.values(state.themeTokens).filter((value) => value.trim().length > 0).length;

  const errors = [scaffoldMutation.error, saveMutation.error, startRunMutation.error]
    .filter((error) => error !== null)
    .map((error) => describeMutationError(error));
  const saved = state.mode === 'scaffold' ? scaffoldMutation.isSuccess : saveMutation.isSuccess;

  return (
    <div className="space-y-4">
      <StepHeading
        title="Start"
        hint={
          state.mode === 'scaffold'
            ? 'Review the intent, write docstube.yml + ia.yml, and start the first generation run.'
            : 'Review the changes, write them back (comments and formatting preserved), and optionally start a run.'
        }
      />
      <dl className="space-y-1.5 rounded border border-neutral-800 p-4">
        <SummaryRow label="Mode" value={state.mode === 'scaffold' ? 'first-run scaffold' : 'edit existing config'} />
        <SummaryRow label="Doc type" value={state.docType ?? '(not set)'} />
        <SummaryRow
          label="Project context"
          value={state.projectContext.trim().length > 0 ? state.projectContext : '(empty)'}
        />
        <SummaryRow label="Personas" value={state.personas.map((persona) => persona.id).join(', ') || '(none)'} />
        <SummaryRow label="Sources" value={sourcesSummary} />
        <SummaryRow label="IA" value={`${countIaNodes(state.iaTree)} node(s) · ${state.iaChoice ?? 'blank'}`} />
        <SummaryRow
          label="Versions & locales"
          value={`${state.currentVersion} · ${[state.sourceLocale, ...state.targetLocales].join(', ')}`}
        />
        <SummaryRow label="Theme tokens" value={`${tokensSet} set`} />
        <SummaryRow label="Site" value={state.siteTitle || '(untitled)'} />
        <SummaryRow label="Components" value={`${state.components.length} enabled`} />
      </dl>
      {issues.length > 0 && (
        <div className="space-y-1 rounded border border-amber-900/60 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
          <p className="font-semibold">Resolve before starting:</p>
          {issues.map(({ stepId, issue }) => (
            <button
              key={`${stepId}-${issue}`}
              type="button"
              className="block text-left underline-offset-2 hover:underline"
              onClick={() => dispatch({ type: 'go-to-step', step: wizardStepIds.indexOf(stepId) })}
            >
              {wizardStepTitles[stepId]}: {issue}
            </button>
          ))}
        </div>
      )}
      {errors.map((error) => (
        <div
          key={error.message}
          role="alert"
          className="rounded border border-rose-900 bg-rose-950/40 px-3 py-2 text-xs text-rose-200"
        >
          <p>{error.message}</p>
          {error.needsAgent && <p className="mt-1 text-rose-300">{agentRunnerHint}</p>}
        </div>
      ))}
      {state.mode === 'scaffold' ? (
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="rounded bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
            disabled={issues.length > 0 || scaffoldMutation.isPending || startRunMutation.isPending}
            onClick={() => void startScaffoldFlow().catch(() => undefined)}
          >
            {scaffoldMutation.isPending || startRunMutation.isPending
              ? 'Starting…'
              : 'Create config & start generating'}
          </button>
          {saved && <span className="text-xs text-emerald-300">docstube.yml + ia.yml written.</span>}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="rounded bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
            disabled={issues.length > 0 || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending ? 'Saving…' : 'Save changes'}
          </button>
          {saveMutation.isSuccess && (
            <span className="text-xs text-emerald-300">
              {saveMutation.data.configUpdates === 0 && !saveMutation.data.iaWritten
                ? 'Nothing changed.'
                : `Saved (${saveMutation.data.configUpdates} config change(s)${saveMutation.data.iaWritten ? ' + ia.yml' : ''}).`}
            </span>
          )}
          <select
            aria-label="Run mode"
            className={`${fieldClasses} w-32`}
            value={runMode}
            onChange={(event) => setRunMode(event.target.value as RunMode)}
          >
            <option value="generate">generate</option>
            <option value="refresh">refresh</option>
            <option value="refine">refine</option>
          </select>
          <button
            type="button"
            className="rounded border border-neutral-600 px-3 py-2 text-sm text-neutral-200 hover:border-neutral-400 disabled:opacity-50"
            disabled={startRunMutation.isPending}
            onClick={() => startRunMutation.mutate(runMode)}
          >
            Start run
          </button>
        </div>
      )}
      {saved && startRunMutation.isError && (
        <button
          type="button"
          className="text-xs text-neutral-400 underline-offset-2 hover:underline"
          onClick={onComplete}
        >
          Go to the dashboard anyway
        </button>
      )}
    </div>
  );
}
