// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DocstubeConfig, FeedbackRecord, Ia } from '@docstube/contracts';
import type { RunRecord, TerminalProgressState, ThemeTokens } from '@docstube/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DashboardPage } from './generation-dashboard.tsx';
import { ProductApp } from './product-app.tsx';
import type { ProductView } from './product-app.tsx';
import type { ReviewPage } from './review-room.tsx';
import type { LocalUiClient } from './setup-trpc.ts';

const timestamp = '2026-06-16T00:00:00.000Z';

const config: DocstubeConfig = {
  version: 1,
  site: { name: 'Backend Docs', locale: 'en' },
  docsType: 'library',
  output: { dir: 'docs', layout: 'single-tree' },
  personas: [{ id: 'developer', title: 'Developer' }],
  agents: { writer: { adapter: 'codex', model: 'backend' } },
  ia: 'ia.yml',
  glossary: 'glossary.yaml',
  theme: { credit: true, tokens: { accent: '#2563eb', surface: '#f8fafc', radius: 8 } }
};

const ia: Ia = {
  version: 1,
  layout: 'single-tree',
  nav: [{ id: 'overview', title: 'Overview', path: 'overview.mdx', brief: 'Backend IA proposal.' }]
};

const run: RunRecord = {
  id: 'run-backend',
  status: 'running',
  capFrozen: false,
  startedAt: timestamp,
  updatedAt: timestamp
};

const themeTokens: ThemeTokens = { accent: '#0f766e', surface: '#ffffff', radius: 6 };

const dashboardPage: DashboardPage = {
  id: 'overview',
  runId: run.id,
  title: 'Overview',
  slug: 'docs/src/pages/index.mdx',
  status: 'passed',
  approved: false,
  findings: [],
  updatedAt: timestamp,
  preview: '# Overview\n\nBackend rendered preview from generated MDX.',
  timeline: [{ at: timestamp, label: 'Passed deterministic checks', status: 'passed' }]
};

const reviewPage: ReviewPage = {
  id: 'overview',
  title: 'Overview',
  slug: 'docs/src/pages/index.mdx',
  approved: false,
  findings: [],
  renderedHtml: '<article><h1>Overview</h1><p>Rendered generated output.</p></article>',
  sections: [{ id: 'intro', title: 'Intro' }]
};

const feedback: FeedbackRecord[] = [
  {
    id: 'feedback-existing',
    createdAt: timestamp,
    scope: 'page',
    message: 'Keep the install flow near the top.',
    pageId: 'overview',
    category: 'instruction',
    status: 'open'
  }
];

const terminalProgress: TerminalProgressState = {
  runId: run.id,
  status: 'running',
  capFrozen: false,
  totalPages: 1,
  nextPageId: undefined,
  counts: { queued: 0, running: 0, retrying: 0, passed: 1, flagged: 0 }
};

type ClientOverrides = {
  dashboardRead?: LocalUiClient['dashboard']['read'];
  reviewRead?: LocalUiClient['review']['read'];
  setupRead?: LocalUiClient['setup']['read'];
};

const createClient = (overrides: ClientOverrides = {}): LocalUiClient => ({
  dashboard: {
    read:
      overrides.dashboardRead ??
      vi.fn<LocalUiClient['dashboard']['read']>(async () => ({
        pages: [dashboardPage],
        run,
        terminalProgress
      }))
  },
  feedback: {
    list: vi.fn<LocalUiClient['feedback']['list']>(async () => feedback),
    submit: vi.fn<LocalUiClient['feedback']['submit']>(async (record) => record)
  },
  pages: {
    approve: vi.fn<LocalUiClient['pages']['approve']>(async (pageId) => ({
      id: pageId,
      runId: run.id,
      title: 'Overview',
      slug: 'docs/src/pages/index.mdx',
      status: 'passed',
      approved: true,
      findings: [],
      updatedAt: timestamp
    })),
    regenerate: vi.fn<LocalUiClient['pages']['regenerate']>(async (pageId) => ({
      id: pageId,
      runId: run.id,
      title: 'Overview',
      slug: 'docs/src/pages/index.mdx',
      status: 'queued',
      approved: false,
      findings: [],
      updatedAt: timestamp
    }))
  },
  review: {
    read:
      overrides.reviewRead ??
      vi.fn<LocalUiClient['review']['read']>(async () => ({
        feedback,
        pages: [reviewPage]
      }))
  },
  setup: {
    read:
      overrides.setupRead ??
      vi.fn<LocalUiClient['setup']['read']>(async () => ({
        config,
        configPath: 'docstube.yml',
        ia,
        themeTokens
      })),
    save: vi.fn<LocalUiClient['setup']['save']>(async (input) => ({
      config: input.config,
      configPath: input.configPath ?? 'docstube.yml',
      ia: input.ia,
      themeTokens: input.themeTokens
    }))
  }
});

const renderProduct = (client: LocalUiClient, view: ProductView = 'setup') => {
  render(<ProductApp client={client} pollMs={0} view={view} />);
};

describe('ProductApp', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows a loading state while local control plane data is pending', () => {
    const client = createClient({
      setupRead: vi.fn<LocalUiClient['setup']['read']>(() => new Promise(() => {}))
    });

    renderProduct(client);

    expect(screen.getByTestId('app-loading').textContent).toContain('Loading local state');
  });

  it('shows an error state when local control plane loading fails', async () => {
    const client = createClient({
      setupRead: vi.fn<LocalUiClient['setup']['read']>(async () => {
        throw new Error('session rejected');
      })
    });

    renderProduct(client);

    await waitFor(() => expect(screen.getByTestId('app-error').textContent).toContain('session rejected'));
  });

  it('loads setup data from the control plane and saves config-family edits through setup.save', async () => {
    const client = createClient();
    renderProduct(client);

    await waitFor(() => expect(screen.getByTestId('setup-wizard-header').textContent).toContain('Backend Docs'));
    fireEvent.change(screen.getByTestId('site-name-input'), { target: { value: 'Backend Docs Renamed' } });
    fireEvent.click(screen.getByTestId('wizard-save'));

    await waitFor(() => expect(client.setup.save).toHaveBeenCalledTimes(1));
    expect(client.setup.save).toHaveBeenCalledWith({
      config: expect.objectContaining({ site: { name: 'Backend Docs Renamed', locale: 'en' } }),
      configPath: 'docstube.yml',
      ia,
      themeTokens
    });
  });

  it('shows an honest empty state when setup data is missing', async () => {
    const client = createClient({
      setupRead: vi.fn<LocalUiClient['setup']['read']>(async () => ({
        config: null,
        configPath: 'docstube.yml',
        ia,
        themeTokens
      }))
    });
    renderProduct(client);

    await waitFor(() => expect(screen.getByTestId('app-empty').textContent).toContain('No config found'));
  });

  it('renders the dashboard from the backend read model', async () => {
    const client = createClient();
    renderProduct(client, 'dashboard');

    await waitFor(() => expect(screen.getByTestId('dashboard-header').textContent).toContain('run-backend'));
    expect(screen.getByTestId('live-preview').textContent).toContain('Backend rendered preview from generated MDX');
    expect(client.dashboard.read).toHaveBeenCalledTimes(1);
  });

  it('shows an honest empty dashboard state when no run exists', async () => {
    const client = createClient({
      dashboardRead: vi.fn<LocalUiClient['dashboard']['read']>(async () => ({
        pages: [],
        run: null,
        terminalProgress: null
      }))
    });
    renderProduct(client, 'dashboard');

    await waitFor(() => expect(screen.getByTestId('app-empty').textContent).toContain('No generation run found'));
  });

  it('renders review data from the backend and keeps actions wired to tRPC mutations', async () => {
    const client = createClient();
    renderProduct(client, 'review');

    await waitFor(() => expect(screen.getByTestId('review-header').textContent).toContain('Overview'));
    expect(screen.getByTestId('production-preview').textContent).toContain('Rendered generated output');
    expect(screen.getByTestId('feedback-history').textContent).toContain('Keep the install flow near the top.');

    fireEvent.click(screen.getByTestId('approve-page'));
    await waitFor(() => expect(client.pages.approve).toHaveBeenCalledWith('overview'));

    fireEvent.click(screen.getByTestId('regenerate-page'));
    await waitFor(() => expect(client.pages.regenerate).toHaveBeenCalledWith('overview'));

    fireEvent.change(screen.getByTestId('feedback-message'), { target: { value: 'Keep this writing instruction.' } });
    fireEvent.click(screen.getByTestId('feedback-submit'));

    await waitFor(() => expect(client.feedback.submit).toHaveBeenCalledTimes(1));
    expect(client.feedback.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'instruction',
        message: 'Keep this writing instruction.',
        pageId: 'overview',
        scope: 'page'
      })
    );
  });
});
