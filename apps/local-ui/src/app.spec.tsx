// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './app.tsx';
import { readSessionFromUrl } from './trpc-client.ts';

afterEach(cleanup);

const renderApp = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <App />
    </QueryClientProvider>
  );

describe('control plane shell', () => {
  it('renders all four surfaces as live tabs', () => {
    renderApp();
    for (const label of ['Dashboard', 'Flag queue', 'Wizard', 'Review']) {
      const tab = screen.getByRole('button', { name: label }) as HTMLButtonElement;
      expect(tab.disabled).toBe(false);
    }
    expect(screen.queryByText('next wave')).toBeNull();
  });

  it('asks for the tokened URL when the session param is missing', () => {
    renderApp();
    expect(screen.getByText('Missing session token')).toBeDefined();
    expect(screen.getByText(/docstube wizard/)).toBeDefined();
  });
});

describe('readSessionFromUrl', () => {
  it('reads the session token and API base from query params', () => {
    window.history.replaceState(null, '', '/?session=abc123&api=http%3A%2F%2F127.0.0.1%3A4242');
    expect(readSessionFromUrl()).toEqual({ sessionToken: 'abc123', apiBaseUrl: 'http://127.0.0.1:4242' });
    window.history.replaceState(null, '', '/?session=abc123');
    expect(readSessionFromUrl()).toEqual({ sessionToken: 'abc123', apiBaseUrl: window.location.origin });
    window.history.replaceState(null, '', '/');
    expect(readSessionFromUrl()).toBeUndefined();
  });
});
