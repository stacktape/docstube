// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Review } from './review.tsx';
import type { ControlPlaneClient } from './trpc-client.ts';
import { TrpcProvider } from './trpc-client.ts';

afterEach(cleanup);

const pageId = 'pg_0123456789abcdefghjk';
const blockId = 'bl_0123456789abcdefghjk';
const sectionId = 'sc_0123456789abcdefghjk';
const claimId = 'cl_0123456789abcdefghjk';

const manifestIndex = {
  schemaVersion: 1,
  docstubeVersion: '0.0.2',
  sourceLocale: 'en',
  locales: ['en'],
  versions: [{ label: 'latest', status: 'current' }],
  pages: [{ id: pageId, slug: 'installation', title: 'Installation', path: 'installation.mdx' }],
  configHash: '0'.repeat(64),
  iaHash: '0'.repeat(64),
  systemFlags: []
};

const emptyProvenance = { sources: [], seedContext: [], observedReads: [], verifications: [] };

// The v2 shard shape: the page carries NO legacy guarantee/claims fields — trust state rides the
// ledger + ClaimEvidence, and the UI projects literal counts from them (wave 2b demolition).
const buildShard = (correctness: 'checked' | 'contradicted' | 'unchecked' = 'checked', withSpine = true) => ({
  schemaVersion: 2,
  locale: 'en',
  version: 'latest',
  sourceCommit: 'a'.repeat(40),
  generatedAt: '2026-07-12T00:00:00.000Z',
  page: {
    id: pageId,
    kind: 'page',
    slug: 'installation',
    title: 'Installation',
    description: 'How to install the CLI.',
    preamble: [],
    sections: [
      {
        id: sectionId,
        kind: 'section',
        title: 'Requirements',
        level: 2,
        anchor: 'requirements',
        blocks: [
          {
            id: blockId,
            kind: 'block',
            blockType: 'code-example',
            language: 'bash',
            contentHash: 'f'.repeat(64),
            variants: [],
            provenance: emptyProvenance
          }
        ]
      }
    ],
    provenance: emptyProvenance
  },
  ...(withSpine
    ? {
        ledger: {
          schemaVersion: 1,
          pageId,
          sourceRevision: 'a'.repeat(40),
          claims: [
            {
              claimId,
              class: 'code-structure',
              predicate: 'docstube installs globally via npm',
              anchor: { blockId, markerId: 'c1' },
              quote: 'npm install -g docstube',
              scope: { entityId: blockId, revision: 'f'.repeat(64) },
              subscriptions: [],
              evidence: [],
              correctness,
              disposition: correctness === 'unchecked' ? 'no-checker-available' : null
            }
          ],
          coverageLint: { uncovered: [] }
        },
        provenance: {
          schemaVersion: 1,
          lineage: {},
          dependencies: {},
          claimEvidence: [
            {
              schemaVersion: 1,
              claimId,
              class: 'code-structure',
              correctness,
              disposition: correctness === 'unchecked' ? 'no-checker-available' : null,
              evidence: []
            }
          ],
          assessments: { reviews: [], translationFidelity: [], structural: [] }
        }
      }
    : {}),
  flags: []
});

const buildClient = (submit: (input: unknown) => Promise<unknown>, shard: unknown = buildShard()): ControlPlaneClient =>
  ({
    manifest: {
      index: { query: () => Promise.resolve(manifestIndex) },
      page: { query: () => Promise.resolve(shard) }
    },
    feedback: { submit: { mutate: submit } },
    runs: { start: { mutate: () => Promise.resolve({ runId: 'run_2' }) } }
  }) as unknown as ControlPlaneClient;

const renderReview = (client: ControlPlaneClient) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TrpcProvider value={client}>
        <Review />
      </TrpcProvider>
    </QueryClientProvider>
  );

const noopSubmit = () => Promise.resolve({ category: 'criteria', file: 'x', text: 'x', warnings: [] });

describe('review UI', () => {
  it('anchors feedback to the selected block entity and renders literal claim counts from the ledger', async () => {
    const submit = vi.fn<(input: unknown) => Promise<unknown>>(() =>
      Promise.resolve({ category: 'instructions', file: '.docstube/instructions/writing.md', text: 'x', warnings: [] })
    );
    renderReview(buildClient(submit));

    fireEvent.click(await screen.findByRole('button', { name: 'Installation' }));
    // The shard renders as a readable block list with LITERAL claim counts — no guarantee chips.
    await screen.findByText('Requirements');
    expect(screen.getByText('code-example')).toBeDefined();
    expect(screen.getAllByText('1/1 checked').length).toBeGreaterThan(0);
    expect(screen.queryByText('proven')).toBeNull();
    expect(screen.queryByText('scored')).toBeNull();
    expect(screen.getByText(/“npm install -g docstube”/)).toBeDefined();
    expect(screen.getByText('checked')).toBeDefined();

    fireEvent.click(screen.getByText('code-example'));
    fireEvent.change(screen.getByLabelText('Feedback'), { target: { value: 'Show the pnpm variant too.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit feedback' }));

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit).toHaveBeenCalledWith({
      entity: { version: 'latest', locale: 'en', pageId, entityId: blockId },
      text: 'Show the pnpm variant too.'
    });
    await screen.findByText(/Routed to instructions/);
  });

  it('selects the section entity from its heading and never offers approval', async () => {
    const submit = vi.fn<(input: unknown) => Promise<unknown>>(noopSubmit);
    renderReview(buildClient(submit));
    fireEvent.click(await screen.findByRole('button', { name: 'Installation' }));
    fireEvent.click(await screen.findByText('Requirements'));
    expect(screen.getByText(new RegExp(sectionId))).toBeDefined();
    // Approval is never a shipping gate (PRODUCT §3.9.4) — rendered as a caption, never a button.
    expect(screen.queryByRole('button', { name: /approve/i })).toBeNull();
    expect(screen.getByText(/approval is never a shipping gate/)).toBeDefined();
  });

  it('renders a contradicted claim LOUDLY: warning banner + per-claim contradicted mark', async () => {
    renderReview(buildClient(vi.fn(noopSubmit), buildShard('contradicted')));
    fireEvent.click(await screen.findByRole('button', { name: 'Installation' }));
    await screen.findByText('Requirements');
    expect(screen.getByRole('alert').textContent).toContain('contradicted by the source');
    expect(screen.getAllByText('⚠ 1 contradicted').length).toBeGreaterThan(0);
    expect(screen.getByText('contradicted')).toBeDefined();
  });

  it('marks an UNCHECKED claim quietly but visibly — distinct from the contradiction alarm (impl-09)', async () => {
    renderReview(buildClient(vi.fn(noopSubmit), buildShard('unchecked')));
    fireEvent.click(await screen.findByRole('button', { name: 'Installation' }));
    await screen.findByText('Requirements');
    // The chip carries the explicit unchecked count; no contradiction alarm renders.
    expect(screen.getAllByText(/· 1 unchecked/).length).toBeGreaterThan(0);
    expect(screen.queryByRole('alert')).toBeNull();
    // The per-claim row shows the 'unchecked' state badge.
    expect(screen.getByText('unchecked')).toBeDefined();
  });

  it('renders a shard WITHOUT a trust spine as explicitly unverified — never a silent 0/0 (impl-08)', async () => {
    renderReview(buildClient(vi.fn(noopSubmit), buildShard('checked', false)));
    fireEvent.click(await screen.findByRole('button', { name: 'Installation' }));
    await screen.findByText('Requirements');
    expect(screen.getByRole('status').textContent).toContain('could not be verified');
    expect(screen.queryByText(/checked$/)).toBeNull();
  });
});
