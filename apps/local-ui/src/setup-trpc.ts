import type { AppRouter } from '@docstube/core';
import type { DocstubeConfig, FeedbackRecord, Ia } from '@docstube/contracts';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { PageDetail, RunRecord, TerminalProgressState, ThemeTokens } from '@docstube/core';
import type { DashboardPage } from './generation-dashboard.tsx';
import type { ReviewPage } from './review-room.tsx';
import type { SetupWizardSaveInput } from './setup-wizard.tsx';

const createTrpcClient = (sessionToken: string) =>
  createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: '/trpc',
        headers: () => ({ 'x-docstube-session': sessionToken })
      })
    ]
  });

export type LocalUiClient = {
  dashboard: {
    read: () => Promise<{
      pages: DashboardPage[];
      run: RunRecord | null;
      terminalProgress: TerminalProgressState | null;
    }>;
  };
  feedback: {
    list: (pageId?: string) => Promise<FeedbackRecord[]>;
    submit: (record: FeedbackRecord) => Promise<FeedbackRecord>;
  };
  pages: {
    approve: (pageId: string) => Promise<PageDetail>;
    regenerate: (pageId: string) => Promise<PageDetail>;
  };
  review: {
    read: () => Promise<{
      feedback: FeedbackRecord[];
      pages: ReviewPage[];
    }>;
  };
  setup: {
    read: (input?: { configPath?: string }) => Promise<{
      config: DocstubeConfig | null;
      configPath: string;
      ia: Ia | null;
      themeTokens: ThemeTokens;
    }>;
    save: (input: SetupWizardSaveInput & { configPath?: string }) => Promise<{
      config: DocstubeConfig;
      configPath: string;
      ia: Ia;
      themeTokens: ThemeTokens;
    }>;
  };
};

export const createLocalUiClient = (sessionToken: string): LocalUiClient => {
  const client = createTrpcClient(sessionToken);

  return {
    dashboard: {
      read: () => client.dashboard.read.query()
    },
    feedback: {
      list: (pageId) => client.feedback.list.query(pageId ? { pageId } : undefined),
      submit: (record) => client.feedback.submit.mutate(record)
    },
    pages: {
      approve: (pageId) => client.pages.approve.mutate({ pageId }),
      regenerate: (pageId) => client.pages.regenerate.mutate({ pageId })
    },
    review: {
      read: () => client.review.read.query()
    },
    setup: {
      read: (input) => client.setup.read.query(input),
      save: (input) => client.setup.save.mutate(input)
    }
  };
};

export const createSetupWizardSaver = (sessionToken: string) => {
  const client = createLocalUiClient(sessionToken);

  return async (input: SetupWizardSaveInput): Promise<void> => {
    await client.setup.save(input);
  };
};
