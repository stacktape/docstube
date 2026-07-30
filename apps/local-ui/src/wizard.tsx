import { useEffect, useReducer, useRef } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTrpc } from './trpc-client.ts';
import { AgentStep } from './wizard-step-agent.tsx';
import { IaStep } from './wizard-step-ia.tsx';
import { StartStep } from './wizard-step-start.tsx';
import { ThemeStep } from './wizard-step-theme.tsx';
import type { WizardStepId } from './wizard-state.ts';
import {
  draftPatch,
  initialWizardState,
  stepIssues,
  wizardReducer,
  wizardStepIds,
  wizardStepTitles
} from './wizard-state.ts';
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

// The setup wizard (PRODUCT §3.9.2). One reducer store, hydrated once from config.family (edit
// mode — the wizard is one editor among others) or, when no config exists, from the deterministic
// detection engine plus the autosaved ONBOARDING DRAFT.
//
// The draft is what makes first run work at all: setup's agent-backed steps read their provider
// from it, so they no longer need a docstube.yml that setup itself has not written yet. It also
// autosaves, so a reload or a crash mid-setup resumes instead of restarting.

const DRAFT_AUTOSAVE_MS = 600;

const stepComponents: Record<Exclude<WizardStepId, 'start'>, (props: StepProps) => ReturnType<typeof DocTypeStep>> = {
  'doc-type': DocTypeStep,
  context: ContextStep,
  personas: PersonasStep,
  sources: SourcesStep,
  agent: AgentStep,
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
  const draftQuery = useQuery({
    queryKey: ['onboarding-draft'],
    queryFn: async () => {
      try {
        return await trpc.setup.draft.query();
      } catch {
        return null;
      }
    },
    retry: false
  });

  const familyPending = familyQuery.isPending;
  const detectPending = detectQuery.isPending;
  const draftPending = draftQuery.isPending;
  useEffect(() => {
    if (state.hydrated || familyPending || detectPending || draftPending) {
      return;
    }
    dispatch({
      type: 'hydrate',
      family: familyQuery.data ?? undefined,
      detection: detectQuery.data,
      draft: draftQuery.data ?? undefined
    });
  }, [state.hydrated, familyPending, detectPending, draftPending, familyQuery.data, detectQuery.data, draftQuery.data]);

  const saveDraft = useMutation({
    mutationFn: (patch: ReturnType<typeof draftPatch>) => trpc.setup.saveDraft.mutate({ patch })
  });

  // Autosave, debounced. Scaffold mode only: in edit mode the committed files are the truth and a
  // draft alongside them would be a second, conflicting source.
  const saveRef = useRef(saveDraft);
  saveRef.current = saveDraft;
  const scaffolding = state.hydrated && state.mode === 'scaffold';
  const patchJson = scaffolding ? JSON.stringify(draftPatch(state)) : undefined;
  useEffect(() => {
    if (patchJson === undefined) {
      return undefined;
    }
    const timer = setTimeout(() => {
      saveRef.current.mutate(JSON.parse(patchJson) as ReturnType<typeof draftPatch>);
    }, DRAFT_AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [patchJson]);

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
          {state.mode === 'scaffold'
            ? 'First-run setup — pre-filled by detection, autosaved as you go.'
            : 'Editing existing docstube.yml.'}
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
