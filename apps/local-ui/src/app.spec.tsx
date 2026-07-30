// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './app.tsx';
import { readSessionFromUrl } from './trpc-client.ts';

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
});

const renderApp = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <App />
    </QueryClientProvider>
  );

// The App builds its own client from the session token, so the control plane is stubbed at the
// fetch layer — the same seam the real tRPC client uses.
const stubControlPlane = (status: { hasConfig: boolean; initialSurface: 'setup' | 'dashboard' }) => {
  window.history.replaceState(null, '', '/#session=abc123');
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.includes('setup.status')
      ? [{ result: { data: { ...status, draft: null } } }]
      : [{ result: { data: [] } }];
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
};

describe('control plane shell', () => {
  // THE FIRST-RUN BUG: the shell opened on the dashboard unconditionally, so a fresh repository
  // landed on an empty page telling the user to go run a command.
  it('opens on setup — not the dashboard — when the control plane reports no config', async () => {
    stubControlPlane({ hasConfig: false, initialSurface: 'setup' });
    renderApp();
    expect(await screen.findByText('First-run setup')).toBeDefined();
    // Dashboard/flags/review are not peer tabs during first run: there is nothing behind them yet.
    expect(screen.queryByRole('button', { name: 'Dashboard' })).toBeNull();
  });

  it('opens on the dashboard once config exists, with all four surfaces as live tabs', async () => {
    stubControlPlane({ hasConfig: true, initialSurface: 'dashboard' });
    renderApp();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Dashboard' })).toBeDefined());
    for (const label of ['Dashboard', 'Flag queue', 'Wizard', 'Review']) {
      const tab = screen.getByRole('button', { name: label }) as HTMLButtonElement;
      expect(tab.disabled).toBe(false);
    }
    expect(screen.getByRole('button', { name: 'Dashboard' }).getAttribute('aria-current')).toBe('page');
  });

  it('asks for the tokened URL when the session param is missing', () => {
    renderApp();
    expect(screen.getByText('Missing session token')).toBeDefined();
    expect(screen.getByText(/carries the one-time session token/)).toBeDefined();
  });
});

describe('readSessionFromUrl', () => {
  it('reads the session token and API base from the URL fragment', () => {
    window.history.replaceState(null, '', '/#session=abc123&api=http%3A%2F%2F127.0.0.1%3A4242');
    expect(readSessionFromUrl()).toEqual({ sessionToken: 'abc123', apiBaseUrl: 'http://127.0.0.1:4242' });
    window.sessionStorage.clear();
    window.history.replaceState(null, '', '/#session=abc123');
    expect(readSessionFromUrl()).toEqual({ sessionToken: 'abc123', apiBaseUrl: window.location.origin });
  });

  it('moves the token into sessionStorage and scrubs it from the address bar', () => {
    window.history.replaceState(null, '', '/#session=abc123&api=http%3A%2F%2F127.0.0.1%3A4242');
    const session = readSessionFromUrl();
    expect(session?.sessionToken).toBe('abc123');
    expect(window.location.hash).toBe('');
    expect(window.location.href).not.toContain('abc123');
    // Subsequent loads (reloads, in-app navigation) restore the session from storage.
    expect(readSessionFromUrl()).toEqual({ sessionToken: 'abc123', apiBaseUrl: 'http://127.0.0.1:4242' });
  });

  it('ignores query params and returns undefined without a fragment or stored session', () => {
    window.history.replaceState(null, '', '/?session=abc123');
    expect(readSessionFromUrl()).toBeUndefined();
    window.history.replaceState(null, '', '/');
    expect(readSessionFromUrl()).toBeUndefined();
  });
});
