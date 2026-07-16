import { useMutation } from '@tanstack/react-query';
import { IaEditor } from './ia-editor.tsx';
import { agentRunnerHint, describeMutationError, useTrpc } from './trpc-client.ts';
import type { StepProps } from './wizard-steps.tsx';
import { StepHeading } from './wizard-steps.tsx';

// Step 5, the soul of the wizard (PRODUCT §3.9.2): three agent-proposed information architectures
// behind a segmented control, flowing into the editable NavTree. Any edit forks to "Custom"; the
// whole step also works with no AI at all (manual tree building from a blank root).

const proposalBadges: Record<string, string> = {
  'task-oriented': 'A',
  'by-module': 'B',
  'user-journey': 'C'
};

export function IaStep({ state, dispatch }: StepProps) {
  const trpc = useTrpc();
  const proposeMutation = useMutation({
    mutationFn: () => trpc.ia.propose.mutate(),
    onSuccess: (result) => dispatch({ type: 'set-proposals', proposals: result.proposals, warnings: result.warnings })
  });

  const selectedProposal = state.proposals.find((proposal) => proposal.id === state.iaChoice);
  const proposeError = proposeMutation.error === null ? undefined : describeMutationError(proposeMutation.error);

  return (
    <div className="space-y-4">
      <StepHeading
        title="Information architecture"
        hint="The page tree the docs are generated into. Propose three starting points with AI, or build it by hand — every node's brief seeds the writer."
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="rounded bg-sky-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-50"
          disabled={proposeMutation.isPending}
          onClick={() => proposeMutation.mutate()}
        >
          {proposeMutation.isPending ? 'Proposing…' : 'Propose with AI'}
        </button>
        {state.proposals.length > 0 && (
          <div
            role="group"
            aria-label="IA proposals"
            className="flex overflow-hidden rounded border border-neutral-700"
          >
            {state.proposals.map((proposal) => (
              <button
                key={proposal.id}
                type="button"
                aria-pressed={state.iaChoice === proposal.id}
                onClick={() => dispatch({ type: 'adopt-proposal', proposal })}
                className={`border-r border-neutral-700 px-3 py-1.5 text-xs last:border-r-0 ${
                  state.iaChoice === proposal.id
                    ? 'bg-neutral-100 font-semibold text-neutral-900'
                    : 'text-neutral-300 hover:bg-neutral-800'
                }`}
              >
                {proposalBadges[proposal.id] ?? '·'} {proposal.label}
              </button>
            ))}
            <button
              type="button"
              aria-pressed={state.iaChoice === 'custom'}
              onClick={() => dispatch({ type: 'mark-ia-custom' })}
              className={`px-3 py-1.5 text-xs ${
                state.iaChoice === 'custom'
                  ? 'bg-neutral-100 font-semibold text-neutral-900'
                  : 'text-neutral-300 hover:bg-neutral-800'
              }`}
            >
              Custom
            </button>
          </div>
        )}
      </div>
      {selectedProposal !== undefined && <p className="text-xs text-neutral-400">{selectedProposal.rationale}</p>}
      {state.iaChoice === 'custom' && state.proposals.length > 0 && (
        <p className="text-xs text-neutral-500">Custom — edited by hand (proposals stay available above).</p>
      )}
      {proposeError !== undefined && (
        <div role="alert" className="rounded border border-rose-900 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
          <p>{proposeError.message}</p>
          {proposeError.needsAgent && <p className="mt-1 text-rose-300">{agentRunnerHint}</p>}
        </div>
      )}
      {state.proposalWarnings.map((warning) => (
        <p
          key={warning}
          className="rounded border border-amber-900/60 bg-amber-950/40 px-3 py-2 text-xs text-amber-200"
        >
          {warning}
        </p>
      ))}
      <IaEditor
        tree={state.iaTree}
        selectedUid={state.selectedIaUid}
        onSelect={(uid) => dispatch({ type: 'select-ia-node', uid })}
        onEdit={(op) => dispatch({ type: 'ia-edit', op })}
      />
    </div>
  );
}
