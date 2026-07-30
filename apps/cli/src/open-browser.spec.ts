import { describe, expect, it } from 'vitest';
import { shouldOpenBrowser } from './open-browser.ts';

describe('browser opening is TTY-safe', () => {
  it('opens on an interactive terminal', () => {
    expect(shouldOpenBrowser({ isTty: true, env: {} })).toMatchObject({ open: true });
  });

  it('prints the URL instead in a non-interactive shell', () => {
    expect(shouldOpenBrowser({ isTty: false, env: {} })).toMatchObject({ open: false });
  });

  it('never opens in CI', () => {
    expect(shouldOpenBrowser({ isTty: true, env: { CI: 'true' } })).toMatchObject({
      open: false,
      reason: 'running in CI'
    });
  });

  it('--no-open always wins, even on a TTY and even against an explicit --open', () => {
    expect(shouldOpenBrowser({ requested: false, isTty: true, env: {} })).toMatchObject({
      open: false,
      reason: '--no-open'
    });
    expect(shouldOpenBrowser({ requested: true, isTty: false, env: { DOCSTUBE_NO_OPEN: '1' } })).toMatchObject({
      open: false
    });
  });

  it('--open forces a launch from a non-interactive shell', () => {
    expect(shouldOpenBrowser({ requested: true, isTty: false, env: {} })).toMatchObject({ open: true });
  });
});
