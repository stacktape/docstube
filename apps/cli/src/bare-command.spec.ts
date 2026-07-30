import { describe, expect, it } from 'vitest';
import { bareCommandAction } from './bare-command.ts';
import { shouldOpenBrowser } from './open-browser.ts';

// Bare `docstube` opens the control plane (PRODUCT §3.9.1). It used to print help, which meant the
// first thing a new user saw was a list of commands instead of setup.

describe('bare command dispatch', () => {
  it('opens the control plane with no arguments', () => {
    expect(bareCommandAction([])).toBe('control-plane');
  });

  // Flags parse away before this sees them, so `docstube --port 4242` has no positionals at all.
  it('opens the control plane when only flags are given', () => {
    expect(bareCommandAction([])).toBe('control-plane');
  });

  it('reports a typo instead of silently opening a UI the user did not ask for', () => {
    expect(bareCommandAction(['generat'])).toEqual({ unknown: 'generat' });
    expect(bareCommandAction(['refresh'])).toEqual({ unknown: 'refresh' });
  });
});

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
