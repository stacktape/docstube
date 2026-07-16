import { useEffect, useReducer } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTrpc } from './trpc-client.ts';
import { IaStep } from './wizard-step-ia.tsx';
import { StartStep } from './wizard-step-start.tsx';
import { ThemeStep } from './wizard-step-theme.tsx';
import type { WizardStepId } from './wizard-state.ts';
import { initialWizardState, stepIssues, wizardReducer, wizardStepIds, wizardStepTitles } from './wizard-state.ts';
import type { StepProps } from './wizard-steps.tsx';
import {
  ComponentsStep,
  ContextStep,
  DocTypeStep,
  MetadataStep,
  PersonasStep,
  SourcesStep,
  VersionsStep
} from './wizard-steps.tsx';

// The ten-step setup wizard (PRODUCT §3.9.2). One reducer store; hydrated once from config.family
// (edit mode — the wizard is one editor among others) or, when no config exists, pre-filled from
// the deterministic detection engine (scaffold mode). The progress rail navigates freely; Next
// and the final Start are gated on per-step validation.

const stepComponents: Record<Exclude<WizardStepId, 'start'>, (props: StepProps) => ReturnType<typeof DocTypeStep>> = {
  'doc-type': DocTypeStep,
  context: ContextStep,
  personas: PersonasStep,
  sources: SourcesStep,
  ia: IaStep,
  versions: VersionsStep,
  theme: ThemeStep,
  metadata: MetadataStep,
  components: ComponentsStep
};

export function Wizard({ onComplete }: { onComplete: () => void }) {
  const trpc = useTrpc();
  const [state, dispatch] = useReducer(wizardReducer, undefined, initialWizardState);

  const familyQuery = useQuery({
    queryKey: ['config-family'],
    // NOT_FOUND (no docstube.yml yet) is the expected first-run signal, not an error — any other
    // failure also lands the wizard in scaffold mode, and the write at the end will surface it.
    queryFn: async () => {
      try {
        return await trpc.config.family.query();
      } catch {
        return null;
      }
    },
    retry: false
  });
  const detectQuery = useQuery({
    queryKey: ['detect-project'],
    queryFn: () => trpc.detect.project.query(),
    retry: false
  });

  const familyPending = familyQuery.isPending;
  const detectPending = detectQuery.isPending;
  useEffect(() => {
    if (state.hydrated || familyPending || detectPending) {
      return;
    }
    dispatch({
      type: 'hydrate',
      family: familyQuery.data ?? undefined,
      detection: detectQuery.data
    });
  }, [state.hydrated, familyPending, detectPending, familyQuery.data, detectQuery.data]);

  if (!state.hydrated) {
    return <p className="p-6 text-sm text-neutral-400">Detecting project…</p>;
  }

  const currentStepId = wizardStepIds[state.step] ?? 'doc-type';
  const currentIssues = stepIssues(state, currentStepId);
  const StepComponent = currentStepId === 'start' ? undefined : stepComponents[currentStepId];

  return (
    <div className="flex min-h-0 flex-1">
      <nav
        aria-label="Wizard steps"
        className="w-64 shrink-0 space-y-0.5 overflow-y-auto border-r border-neutral-800 p-3"
      >
        <p className="px-2 pb-2 text-xs text-neutral-500">
          {state.mode === 'scaffold' ? 'First-run setup — pre-filled by detection.' : 'Editing existing docstube.yml.'}
        </p>
        {wizardStepIds.map((stepId, index) => {
          const active = index === state.step;
          const issues = stepIssues(state, stepId);
          return (
            <button
              key={stepId}
              type="button"
              aria-label={wizardStepTitles[stepId]}
              aria-current={active ? 'step' : undefined}
              onClick={() => dispatch({ type: 'go-to-step', step: index })}
              className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${
                active ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-400 hover:bg-neutral-900'
              }`}
            >
              <span
                className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] ${
                  issues.length === 0 ? 'bg-emerald-950 text-emerald-300' : 'bg-neutral-800 text-neutral-400'
                }`}
              >
                {index + 1}
              </span>
              <span className="truncate">{wizardStepTitles[stepId]}</span>
            </button>
          );
        })}
      </nav>
      <section className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl space-y-4 p-6">
          {StepComponent === undefined ? (
            <StartStep state={state} dispatch={dispatch} onComplete={onComplete} />
          ) : (
            <StepComponent state={state} dispatch={dispatch} />
          )}
          {currentIssues.length > 0 && currentStepId !== 'start' && (
            <ul className="space-y-0.5 rounded border border-amber-900/60 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
              {currentIssues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}
          <div className="flex items-center justify-between border-t border-neutral-800 pt-4">
            <button
              type="button"
              className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:border-neutral-500 disabled:opacity-40"
              disabled={state.step === 0}
              onClick={() => dispatch({ type: 'go-to-step', step: state.step - 1 })}
            >
              Back
            </button>
            <span className="text-xs text-neutral-600">
              Step {state.step + 1} of {wizardStepIds.length}
            </span>
            <button
              type="button"
              className="rounded bg-neutral-100 px-3 py-1.5 text-sm font-semibold text-neutral-900 hover:bg-white disabled:opacity-40"
              disabled={state.step === wizardStepIds.length - 1 || currentIssues.length > 0}
              onClick={() => dispatch({ type: 'go-to-step', step: state.step + 1 })}
            >
              Next
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
