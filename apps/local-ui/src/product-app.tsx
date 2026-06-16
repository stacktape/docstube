import { AlertTriangle, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { FeedbackRecord } from '@docstube/contracts';
import { GenerationDashboard } from './generation-dashboard.tsx';
import { ReviewRoom, defaultCategorizeReviewFeedback } from './review-room.tsx';
import type { FeedbackWriteTarget } from './review-room.tsx';
import type { LocalUiClient } from './setup-trpc.ts';
import { SetupWizard } from './setup-wizard.tsx';
import type { SetupWizardSaveInput } from './setup-wizard.tsx';

export type ProductView = 'dashboard' | 'review' | 'setup';

export type ProductAppProps = {
  client: LocalUiClient;
  configPath?: string;
  pollMs?: number;
  view: ProductView;
};

type SetupData = Awaited<ReturnType<LocalUiClient['setup']['read']>>;
type DashboardData = Awaited<ReturnType<LocalUiClient['dashboard']['read']>>;
type ReviewData = Awaited<ReturnType<LocalUiClient['review']['read']>>;

type ProductData = {
  dashboard?: DashboardData;
  review?: ReviewData;
  setup?: SetupData;
};

type LoadState = { status: 'error'; error: Error } | { status: 'loaded'; data: ProductData } | { status: 'loading' };

const asError = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)));

export const loadProductData = async (
  client: LocalUiClient,
  view: ProductView,
  configPath?: string
): Promise<ProductData> => {
  if (view === 'dashboard') {
    return { dashboard: await client.dashboard.read() };
  }

  if (view === 'review') {
    const review = await client.review.read();
    return { review: { ...review, feedback: await client.feedback.list() } };
  }

  return { setup: await client.setup.read(configPath ? { configPath } : undefined) };
};

function StateShell(props: { kind: 'empty' | 'error' | 'loading'; message: string; title: string }) {
  return (
    <main className="setup-shell" data-testid={`app-${props.kind}`}>
      <section className="setup-panel">
        <div className="panel-heading">
          {props.kind === 'loading' ? (
            <Loader2 aria-hidden="true" size={18} />
          ) : (
            <AlertTriangle aria-hidden="true" size={18} />
          )}
          <h2>{props.title}</h2>
        </div>
        <p className="empty-note">{props.message}</p>
      </section>
    </main>
  );
}

function SetupView(props: {
  client: LocalUiClient;
  configPath?: string;
  data: SetupData;
  refresh: () => Promise<void>;
}) {
  const save = async (input: SetupWizardSaveInput) => {
    await props.client.setup.save({ ...input, configPath: props.configPath ?? props.data.configPath });
    await props.refresh();
  };

  if (!props.data.config) {
    return (
      <StateShell
        kind="empty"
        title="No config found"
        message="The local control plane did not return a docstube config yet."
      />
    );
  }

  if (!props.data.ia) {
    return (
      <StateShell
        kind="empty"
        title="No IA found"
        message="The setup wizard needs IA data from the local control plane before it can edit the nav tree."
      />
    );
  }

  const themeTokens =
    Object.keys(props.data.themeTokens).length > 0 ? props.data.themeTokens : props.data.config.theme?.tokens;

  return (
    <SetupWizard
      initialConfig={props.data.config}
      initialIa={props.data.ia}
      initialThemeTokens={themeTokens}
      onSave={save}
    />
  );
}

function DashboardView(props: { data: DashboardData }) {
  if (!props.data.run) {
    return (
      <StateShell
        kind="empty"
        title="No generation run found"
        message="No persisted run is available for the current project."
      />
    );
  }

  if (props.data.pages.length === 0) {
    return (
      <StateShell
        kind="empty"
        title="No pages queued"
        message="The current run does not have any persisted page state yet."
      />
    );
  }

  return (
    <GenerationDashboard
      run={props.data.run}
      pages={props.data.pages}
      terminalProgress={props.data.terminalProgress ?? undefined}
    />
  );
}

function ReviewView(props: { client: LocalUiClient; data: ReviewData; refresh: () => Promise<void> }) {
  if (props.data.pages.length === 0) {
    return (
      <StateShell
        kind="empty"
        title="No pages to review"
        message="No persisted page state is available for review yet."
      />
    );
  }

  const approve = async (pageId: string) => {
    await props.client.pages.approve(pageId);
    await props.refresh();
  };
  const regenerate = async (pageId: string) => {
    await props.client.pages.regenerate(pageId);
    await props.refresh();
  };
  const writeFeedback = async (_target: FeedbackWriteTarget, record: FeedbackRecord) => {
    await props.client.feedback.submit(record);
    await props.refresh();
  };

  return (
    <ReviewRoom
      feedback={props.data.feedback}
      pages={props.data.pages}
      categorizeFeedback={defaultCategorizeReviewFeedback}
      onApprove={approve}
      onRegenerate={regenerate}
      onWriteFeedback={writeFeedback}
    />
  );
}

export function ProductApp(props: ProductAppProps) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  const refresh = useCallback(async () => {
    try {
      const data = await loadProductData(props.client, props.view, props.configPath);
      setState({ status: 'loaded', data });
    } catch (error) {
      setState({ status: 'error', error: asError(error) });
    }
  }, [props.client, props.configPath, props.view]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = await loadProductData(props.client, props.view, props.configPath);
        if (!cancelled) {
          setState({ status: 'loaded', data });
        }
      } catch (error) {
        if (!cancelled) {
          setState({ status: 'error', error: asError(error) });
        }
      }
    };

    void load();
    const interval =
      props.pollMs && props.pollMs > 0
        ? window.setInterval(() => {
            void load();
          }, props.pollMs)
        : undefined;

    return () => {
      cancelled = true;
      if (interval !== undefined) {
        window.clearInterval(interval);
      }
    };
  }, [props.client, props.configPath, props.pollMs, props.view]);

  if (state.status === 'loading') {
    return <StateShell kind="loading" title="Loading local state" message="Reading from the local control plane." />;
  }

  if (state.status === 'error') {
    return <StateShell kind="error" title="Local state unavailable" message={state.error.message} />;
  }

  if (props.view === 'dashboard') {
    return state.data.dashboard ? (
      <DashboardView data={state.data.dashboard} />
    ) : (
      <StateShell
        kind="empty"
        title="Dashboard unavailable"
        message="The local control plane returned no dashboard state."
      />
    );
  }

  if (props.view === 'review') {
    return state.data.review ? (
      <ReviewView client={props.client} data={state.data.review} refresh={refresh} />
    ) : (
      <StateShell kind="empty" title="Review unavailable" message="The local control plane returned no review state." />
    );
  }

  return state.data.setup ? (
    <SetupView client={props.client} configPath={props.configPath} data={state.data.setup} refresh={refresh} />
  ) : (
    <StateShell kind="empty" title="Setup unavailable" message="The local control plane returned no setup state." />
  );
}
