import { useMutation } from '@tanstack/react-query';
import { ThemePreview } from './theme-preview.tsx';
import { agentRunnerHint, describeMutationError, useTrpc } from './trpc-client.ts';
import type { StepProps } from './wizard-steps.tsx';
import { StepHeading, fieldClasses } from './wizard-steps.tsx';
import { themeTokenNames } from './wizard-state.ts';

// Step 7 (PRODUCT §3.9.2): token editor with the persistent miniature live preview (an in-page
// mock this wave — see theme-preview.tsx for the scaled-iframe TODO), plus "Match my existing
// project" which runs the agent-backed token extraction and merges into the same editor.

const looksLikeColor = (value: string): boolean => /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim());

export function ThemeStep({ state, dispatch }: StepProps) {
  const trpc = useTrpc();
  const extractMutation = useMutation({
    mutationFn: () => trpc.theme.extractTokens.mutate(),
    onSuccess: (result) => dispatch({ type: 'merge-theme-tokens', tokens: result.tokens as Record<string, string> })
  });
  const extractError = extractMutation.error === null ? undefined : describeMutationError(extractMutation.error);

  return (
    <div className="space-y-4">
      <StepHeading
        title="Theme"
        hint="Design tokens applied to the emitted site. Leave a token empty to keep the shipped default."
      />
      <button
        type="button"
        className="rounded border border-neutral-600 px-3 py-1.5 text-sm text-neutral-200 hover:border-neutral-400 disabled:opacity-50"
        disabled={extractMutation.isPending}
        onClick={() => extractMutation.mutate()}
      >
        {extractMutation.isPending ? 'Extracting…' : 'Match my existing project'}
      </button>
      {extractMutation.data?.notes !== undefined && (
        <p className="text-xs text-neutral-400">{extractMutation.data.notes}</p>
      )}
      {(extractMutation.data?.warnings ?? []).map((warning) => (
        <p
          key={warning}
          className="rounded border border-amber-900/60 bg-amber-950/40 px-3 py-2 text-xs text-amber-200"
        >
          {warning}
        </p>
      ))}
      {extractError !== undefined && (
        <div role="alert" className="rounded border border-rose-900 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
          <p>{extractError.message}</p>
          {extractError.needsAgent && <p className="mt-1 text-rose-300">{agentRunnerHint}</p>}
        </div>
      )}
      <div className="flex gap-6">
        <div className="w-96 shrink-0 space-y-2">
          {themeTokenNames.map((name) => {
            const value = state.themeTokens[name] ?? '';
            return (
              <label key={name} className="flex items-center gap-2 text-xs text-neutral-400">
                <span className="w-32 shrink-0 font-mono">{name}</span>
                <input
                  aria-label={`Theme token ${name}`}
                  className={fieldClasses}
                  placeholder={name === 'font-family' ? 'ui-sans-serif, system-ui, …' : '#0f766e'}
                  value={value}
                  onChange={(event) => dispatch({ type: 'set-theme-token', name, value: event.target.value })}
                />
                <span
                  aria-hidden="true"
                  className="h-5 w-5 shrink-0 rounded border border-neutral-700"
                  style={looksLikeColor(value) ? { backgroundColor: value } : {}}
                />
              </label>
            );
          })}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Live preview</h3>
          <ThemePreview tokens={state.themeTokens} />
          <p className="text-xs text-neutral-600">
            In-page mock for instant feedback — a scaled iframe of the real sample page is the planned upgrade.
          </p>
        </div>
      </div>
    </div>
  );
}
