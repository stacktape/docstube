// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlagQueue } from './flag-queue.tsx';
import type { ControlPlaneClient, FlagQueueEntry } from './trpc-client.ts';
import { TrpcProvider } from './trpc-client.ts';

afterEach(cleanup);

const flagId = 'fl_0123456789abcdefghjk';

const openTribalFlag = (): FlagQueueEntry => ({
  flag: {
    id: flagId,
    kind: 'tribal-knowledge',
    status: 'open',
    summary: 'Why is the retry limit 3?',
    question: 'Is the retry limit of 3 intentional?',
    createdAt: '2026-07-12T00:00:00.000Z'
  },
  scope: 'page',
  locale: 'en',
  pageId: 'pg_0123456789abcdefghjk',
  pageTitle: 'Installation'
});

// Stateful fake: answering mutates the store, so the invalidated refetch shows the committed flag.
const buildQueueClient = () => {
  let entries = [openTribalFlag()];
  const answer = vi.fn<(input: { flagId: string; text: string }) => Promise<unknown>>((input) => {
    entries = entries.map((entry) =>
      entry.flag.id === input.flagId
        ? {
            ...entry,
            flag: {
              ...entry.flag,
              status: 'answered' as const,
              answer: { text: input.text, answeredAt: '2026-07-12T01:00:00.000Z', author: 'local-ui' }
            }
          }
        : entry
    );
    return Promise.resolve(entries[0]?.flag);
  });
  const dismiss = vi.fn<(input: { flagId: string }) => Promise<unknown>>((input) => {
    entries = entries.map((entry) =>
      entry.flag.id === input.flagId ? { ...entry, flag: { ...entry.flag, status: 'dismissed' as const } } : entry
    );
    return Promise.resolve(entries[0]?.flag);
  });
  const client = {
    flags: {
      list: { query: () => Promise.resolve(entries) },
      answer: { mutate: answer },
      dismiss: { mutate: dismiss }
    }
  } as unknown as ControlPlaneClient;
  return { client, answer, dismiss };
};

const renderQueue = (client: ControlPlaneClient) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TrpcProvider value={client}>
        <FlagQueue />
      </TrpcProvider>
    </QueryClientProvider>
  );

describe('flag queue actions', () => {
  it('answers a tribal-knowledge flag and shows it committed to knowledge', async () => {
    const { client, answer } = buildQueueClient();
    renderQueue(client);

    fireEvent.click(await screen.findByText('Why is the retry limit 3?'));
    fireEvent.change(screen.getByLabelText('Answer'), {
      target: { value: 'Three retries matched the upstream rate limit.' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Answer' }));

    await waitFor(() =>
      expect(answer).toHaveBeenCalledWith({ flagId, text: 'Three retries matched the upstream rate limit.' })
    );
    // The answered tribal flag stays visible with the committed-to-knowledge chip.
    await screen.findByText('committed to knowledge');
  });

  it('dismisses a flag and drops it from the queue', async () => {
    const { client, dismiss } = buildQueueClient();
    renderQueue(client);

    fireEvent.click(await screen.findByText('Why is the retry limit 3?'));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    await waitFor(() => expect(dismiss).toHaveBeenCalledWith({ flagId }));
    await screen.findByText('No open flags. Nothing needs human attention.');
  });
});
