// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ControlPlaneClient } from './trpc-client.ts';
import { TrpcProvider } from './trpc-client.ts';
import { Wizard } from './wizard.tsx';

afterEach(cleanup);

// A fake control plane client injected through the same TrpcProvider seam the app uses. Only the
// procedures a test exercises need real handlers; everything else can stay undefined.
const detectResult = {
  detection: {
    docType: 'external-library',
    siteTitle: 'Acme Kit',
    projectContext: 'A toolkit for building acme apps.',
    languages: ['typescript'],
    openapiSpecs: ['specs/api.yml'],
    asyncapiSpecs: [],
    frameworks: [],
    packageManager: 'pnpm',
    monorepo: false
  },
  suggestedPersonas: [{ id: 'app-developer', description: 'Developer integrating the library.' }]
};

const proposalsResult = {
  proposals: [
    {
      id: 'task-oriented',
      label: 'Task-oriented',
      rationale: 'Readers arrive with jobs to do.',
      ia: {
        schemaVersion: 1,
        tree: [{ title: 'Install', slug: 'install', brief: 'How to install.', depth: 'standard' }]
      }
    },
    {
      id: 'by-module',
      label: 'By module',
      rationale: 'Mirrors the package layout.',
      ia: { schemaVersion: 1, tree: [{ title: 'Core', slug: 'core' }] }
    },
    {
      id: 'user-journey',
      label: 'User journey',
      rationale: 'Evaluate, start, go deep.',
      ia: { schemaVersion: 1, tree: [{ title: 'Start', slug: 'start' }] }
    }
  ],
  warnings: []
};

type FakeOverrides = {
  propose?: () => Promise<unknown>;
  scaffold?: (input: unknown) => Promise<unknown>;
  startRun?: (input: unknown) => Promise<unknown>;
};

const fakeClient = (overrides: FakeOverrides = {}): ControlPlaneClient =>
  ({
    config: {
      family: { query: () => Promise.reject(new Error('NOT_FOUND: docstube.yml not found')) },
      update: { mutate: () => Promise.resolve({}) }
    },
    detect: { project: { query: () => Promise.resolve(detectResult) } },
    ia: {
      propose: { mutate: overrides.propose ?? (() => Promise.resolve(proposalsResult)) },
      update: { mutate: () => Promise.resolve({}) }
    },
    setup: { scaffold: { mutate: overrides.scaffold ?? (() => Promise.resolve({ configPath: '', iaPath: '' })) } },
    runs: { start: { mutate: overrides.startRun ?? (() => Promise.resolve({ runId: 'run_1' })) } },
    theme: { extractTokens: { mutate: () => Promise.resolve({ tokens: {}, warnings: [] }) } }
  }) as unknown as ControlPlaneClient;

const renderWizard = (client: ControlPlaneClient, onComplete: () => void = () => undefined) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TrpcProvider value={client}>
        <Wizard onComplete={onComplete} />
      </TrpcProvider>
    </QueryClientProvider>
  );

const next = () => fireEvent.click(screen.getByRole('button', { name: 'Next' }));

const rejectWithoutAgentRunner = () =>
  Promise.reject(new Error('agent runner not configured — starting runs is unavailable in this control plane session'));

describe('wizard detection prefill and navigation', () => {
  it('pre-fills confident detections and navigates with back/next', async () => {
    renderWizard(fakeClient());
    const libraryCard = await screen.findByRole('button', { name: /External · Library/ });
    expect(libraryCard.getAttribute('aria-pressed')).toBe('true');

    next();
    const context = screen.getByRole('textbox', { name: 'Project context' }) as HTMLTextAreaElement;
    expect(context.value).toBe('A toolkit for building acme apps.');
    expect(screen.getByText(/extracted, never generated/)).toBeDefined();

    next();
    expect((screen.getByLabelText('Persona 1 id') as HTMLInputElement).value).toBe('app-developer');

    next();
    expect((screen.getByLabelText('OpenAPI specs path 1') as HTMLInputElement).value).toBe('specs/api.yml');
    expect(screen.getByText(/unverified until re-grounded/)).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText('Persona 1 id')).toBeDefined();
  });
});

describe('wizard IA step', () => {
  it('adopts a proposal and forks to Custom on any edit', async () => {
    renderWizard(fakeClient());
    await screen.findByRole('button', { name: /External · Library/ });
    fireEvent.click(screen.getByRole('button', { name: /Information architecture/ }));

    fireEvent.click(screen.getByRole('button', { name: 'Propose with AI' }));
    const proposalSegment = await screen.findByRole('button', { name: 'A Task-oriented' });
    fireEvent.click(proposalSegment);
    expect(proposalSegment.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Readers arrive with jobs to do.')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: /Install/ }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Installation' } });
    expect(screen.getByRole('button', { name: 'Custom' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'A Task-oriented' }).getAttribute('aria-pressed')).toBe('false');
    // The auto-slug follows the title while the slug is still derived.
    expect((screen.getByLabelText('Slug') as HTMLInputElement).value).toBe('installation');
  });

  it('supports manual tree building without AI', async () => {
    renderWizard(fakeClient({ propose: () => Promise.reject(new Error('should not be called')) }));
    await screen.findByRole('button', { name: /External · Library/ });
    fireEvent.click(screen.getByRole('button', { name: /Information architecture/ }));
    fireEvent.click(screen.getByRole('button', { name: '+ Add top-level page' }));
    expect(screen.getByRole('button', { name: /New page/ })).toBeDefined();
  });
});

describe('wizard theme step', () => {
  it('restyles the live preview as tokens change', async () => {
    renderWizard(fakeClient());
    await screen.findByRole('button', { name: /External · Library/ });
    fireEvent.click(screen.getByRole('button', { name: /Theme/ }));

    fireEvent.change(screen.getByLabelText('Theme token accent'), { target: { value: '#123456' } });
    const link = screen.getByTestId('preview-accent-link') as HTMLAnchorElement;
    expect(link.style.color).toBe('rgb(18, 52, 86)');

    fireEvent.change(screen.getByLabelText('Theme token surface'), { target: { value: '#ffffff' } });
    expect((screen.getByTestId('theme-preview') as HTMLDivElement).style.backgroundColor).toBe('rgb(255, 255, 255)');
  });
});

describe('wizard start step', () => {
  it('scaffolds the config family and starts a generate run', async () => {
    const scaffold = vi.fn<(input: unknown) => Promise<unknown>>(() =>
      Promise.resolve({ configPath: 'docstube.yml', iaPath: 'ia.yml' })
    );
    const startRun = vi.fn<(input: unknown) => Promise<unknown>>(() => Promise.resolve({ runId: 'run_1' }));
    const onComplete = vi.fn<() => void>();
    renderWizard(fakeClient({ scaffold, startRun }), onComplete);
    await screen.findByRole('button', { name: /External · Library/ });

    // The IA is the only essential step detection cannot pre-fill.
    fireEvent.click(screen.getByRole('button', { name: /Information architecture/ }));
    fireEvent.click(screen.getByRole('button', { name: '+ Add top-level page' }));

    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create config & start generating' }));

    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(scaffold).toHaveBeenCalledTimes(1);
    const payload = scaffold.mock.calls[0]?.[0] as { config: Record<string, unknown>; ia: Record<string, unknown> };
    expect(payload.config).toMatchObject({
      schemaVersion: 1,
      docType: 'external-library',
      projectContext: 'A toolkit for building acme apps.',
      personas: [{ id: 'app-developer', description: 'Developer integrating the library.' }],
      sources: { openapi: ['specs/api.yml'], asyncapi: [], imports: [] },
      versions: { current: 'latest', frozen: [] },
      locales: { source: 'en', targets: [] },
      site: { title: 'Acme Kit' }
    });
    expect(payload.ia).toEqual({ schemaVersion: 1, tree: [{ title: 'New page', slug: 'new-page' }] });
    expect(startRun).toHaveBeenCalledWith({ mode: 'generate' });
  });

  it('surfaces the agent-runner precondition message verbatim', async () => {
    renderWizard(fakeClient({ startRun: rejectWithoutAgentRunner }));
    await screen.findByRole('button', { name: /External · Library/ });
    fireEvent.click(screen.getByRole('button', { name: /Information architecture/ }));
    fireEvent.click(screen.getByRole('button', { name: '+ Add top-level page' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create config & start generating' }));
    expect(await screen.findByText(/agent runner not configured — starting runs is unavailable/)).toBeDefined();
    expect(screen.getByText(/docstube wizard/)).toBeDefined();
  });
});
