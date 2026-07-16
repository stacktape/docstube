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

const shard = {
  schemaVersion: 1,
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
        guarantee: 'proven',
        blocks: [
          {
            id: blockId,
            kind: 'block',
            blockType: 'code-example',
            language: 'bash',
            contentHash: 'f'.repeat(64),
            variants: [],
            guarantee: 'proven',
            provenance: emptyProvenance,
            claims: [
              {
                id: 'cl_0123456789abcdefghjk',
                kind: 'claim',
                text: 'docstube installs globally via npm',
                anchor: { quote: 'npm install -g docstube', prefix: '', suffix: '' },
                claimClass: 'code-sample',
                guarantee: 'proven'
              }
            ]
          }
        ]
      }
    ],
    guarantee: 'scored',
    provenance: emptyProvenance
  },
  flags: []
};

const buildClient = (submit: (input: unknown) => Promise<unknown>): ControlPlaneClient =>
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

describe('review UI', () => {
  it('anchors feedback to the selected block entity', async () => {
    const submit = vi.fn<(input: unknown) => Promise<unknown>>(() =>
      Promise.resolve({ category: 'instructions', file: '.docstube/instructions/writing.md', text: 'x', warnings: [] })
    );
    renderReview(buildClient(submit));

    fireEvent.click(await screen.findByRole('button', { name: 'Installation' }));
    // The shard renders as a readable block list with guarantee chips.
    await screen.findByText('Requirements');
    expect(screen.getByText('code-example')).toBeDefined();
    expect(screen.getAllByText('proven').length).toBeGreaterThan(0);
    expect(screen.getByText(/“npm install -g docstube”/)).toBeDefined();

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
    const submit = vi.fn<(input: unknown) => Promise<unknown>>(() =>
      Promise.resolve({ category: 'criteria', file: '.docstube/criteria/base.md', text: 'x', warnings: [] })
    );
    renderReview(buildClient(submit));
    fireEvent.click(await screen.findByRole('button', { name: 'Installation' }));
    fireEvent.click(await screen.findByText('Requirements'));
    expect(screen.getByText(new RegExp(sectionId))).toBeDefined();
    // Approval is never a shipping gate (PRODUCT §3.9.4) — rendered as a caption, never a button.
    expect(screen.queryByRole('button', { name: /approve/i })).toBeNull();
    expect(screen.getByText(/approval is never a shipping gate/)).toBeDefined();
  });
});
