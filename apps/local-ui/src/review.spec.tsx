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

const startedRun = { runId: 'run_2', mode: 'refine', started: true, alreadyRunning: null, tookOverStaleLock: null };

const buildClient = (
  submit: (input: unknown) => Promise<unknown>,
  shard: unknown = buildShard(),
  startRun: () => Promise<unknown> = () => Promise.resolve(startedRun)
): ControlPlaneClient =>
  ({
    manifest: {
      index: { query: () => Promise.resolve(manifestIndex) },
      page: { query: () => Promise.resolve(shard) }
    },
    feedback: { submit: { mutate: submit } },
    runs: { start: { mutate: startRun } }
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
    expect(screen.getAllByText(/⚠ 1 contradicted/).length).toBeGreaterThan(0);
    expect(screen.getByText('contradicted')).toBeDefined();
  });

  it('a contradicted page still shows the FULL picture: contradicted + checked/total + unmarked (impl-24)', async () => {
    // The contradiction is the alarm, but it must not SUBTRACT information: the chip used to
    // collapse to "⚠ N contradicted" and hide the ledger counts entirely, leaving the reviewer with
    // the most to decide with the least to decide on.
    const shard = buildShard('contradicted') as { ledger: { coverageLint: { uncovered: unknown[] } } };
    shard.ledger.coverageLint = {
      uncovered: [{ blockId, excerpt: 'The `retryLimit` defaults to 5.', detector: 'identifier-with-numeric-literal' }]
    };
    renderReview(buildClient(vi.fn(noopSubmit), shard));
    fireEvent.click(await screen.findByRole('button', { name: 'Installation' }));
    await screen.findByText('Requirements');
    const chip = screen.getAllByText(/⚠ 1 contradicted/)[0]?.closest('span[class*="rounded"]');
    expect(chip?.textContent).toContain('⚠ 1 contradicted');
    expect(chip?.textContent).toContain('0/1 checked');
    expect(chip?.textContent).toContain('1 unmarked');
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

  it('surfaces unmarked assertions beside the counts — ledger omission never reads as a checked page', async () => {
    // NO HIDDEN DENOMINATOR (PRODUCT §1.2): the coverage linter's spans ride the shard ledger, and
    // the reviewer surface reports them next to the checked counts exactly as the theme does.
    const shard = buildShard('checked') as { ledger: { coverageLint: { uncovered: unknown[] } } };
    shard.ledger.coverageLint = {
      uncovered: [{ blockId, excerpt: 'The `retryLimit` defaults to 5.', detector: 'identifier-with-numeric-literal' }]
    };
    renderReview(buildClient(vi.fn(noopSubmit), shard));
    fireEvent.click(await screen.findByRole('button', { name: 'Installation' }));
    await screen.findByText('Requirements');
    expect(screen.getAllByText(/· 1 unmarked/).length).toBeGreaterThan(0);
  });

  it('says "checked against uncommitted changes" and withholds the complete look on a dirty-tree run', async () => {
    // A DIRTY WORKING TREE CANNOT MINT THE COMPLETE STATE (PRODUCT §1.2, spine finding): the run
    // read bytes no commit contains. The counts are content-hash bound, so they stay — the green
    // treatment does not, and the reviewer is told why, in the same wording every theme uses.
    const shard = buildShard('checked') as { provenance: { lineage: Record<string, unknown> } };
    shard.provenance.lineage = { dirtyWorkingTree: true };
    renderReview(buildClient(vi.fn(noopSubmit), shard));
    fireEvent.click(await screen.findByRole('button', { name: 'Installation' }));
    await screen.findByText('Requirements');
    const chip = screen.getAllByText(/checked against uncommitted changes/)[0]?.closest('span[class*="rounded"]');
    expect(chip?.textContent).toContain('1/1 checked');
    expect(chip?.textContent).toContain('checked against uncommitted changes');
    // 1/1 checked with nothing unmarked would otherwise be the complete/green state.
    expect(chip?.className).not.toContain('emerald');
  });

  it('withholds the complete look at EVERY level on a dirty run — page, section and block agree', async () => {
    // ROLLUPS INHERIT THE FLAG (wave 2b close — the spine finding): dirtyWorkingTree is a property
    // of the RUN, not of a claim subset, so a section or block rollup that dropped it could paint
    // the green/complete treatment the page-level chip had already withheld. Counts stay literal at
    // every level; only the complete state degrades, everywhere at once.
    const shard = buildShard('checked') as { provenance: { lineage: Record<string, unknown> } };
    shard.provenance.lineage = { dirtyWorkingTree: true };
    renderReview(buildClient(vi.fn(noopSubmit), shard));
    fireEvent.click(await screen.findByRole('button', { name: 'Installation' }));
    await screen.findByText('Requirements');

    // Page, section and block chips: 1/1 checked with nothing unmarked would otherwise be green.
    const chips = screen.getAllByText(/1\/1 checked/);
    expect(chips.length).toBe(3);
    for (const chip of chips) {
      const rendered = chip.closest('span[class*="rounded"]');
      expect(rendered?.textContent).toContain('1/1 checked');
      expect(rendered?.textContent).toContain('checked against uncommitted changes');
      // The complete/green treatment is withheld at this level too — no chip out-greens the page.
      expect(rendered?.className).not.toContain('emerald');
    }
  });

  // ONE RUN AT A TIME (run-lock.ts). A second "Regenerate" while a run is in flight starts NOTHING
  // — the control plane hands back the running run's id with `started: false`. That is a normal
  // outcome of a double-click, not an error, so the UI must say which of the two happened instead
  // of claiming a run it did not start.
  it('says a run STARTED, and says so differently when one was already in flight', async () => {
    renderReview(buildClient(vi.fn(noopSubmit)));
    fireEvent.click(await screen.findByRole('button', { name: 'Installation' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Regenerate (refine run)' }));
    await screen.findByText('Run run_2 started.');
    cleanup();

    renderReview(
      buildClient(vi.fn(noopSubmit), buildShard(), () =>
        Promise.resolve({
          runId: 'run_1',
          mode: 'generate',
          started: false,
          alreadyRunning: { runId: 'run_1', mode: 'generate', pid: 4242, host: 'workstation' },
          tookOverStaleLock: null
        })
      )
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Installation' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Regenerate (refine run)' }));
    const notice = await screen.findByText(/already in flight/);
    expect(notice.textContent).toContain('A generate was already in flight');
    expect(notice.textContent).toContain('run_1');
    // Nothing about this reads as a failure.
    expect(screen.queryByText('Run run_1 started.')).toBeNull();
  });

  it('renders a shard WITHOUT a trust spine as explicitly unverified — never a silent 0/0 (impl-08)', async () => {
    renderReview(buildClient(vi.fn(noopSubmit), buildShard('checked', false)));
    fireEvent.click(await screen.findByRole('button', { name: 'Installation' }));
    await screen.findByText('Requirements');
    expect(screen.getByRole('status').textContent).toContain('could not be verified');
    expect(screen.queryByText(/checked$/)).toBeNull();
  });
});
