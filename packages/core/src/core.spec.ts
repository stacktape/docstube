import { describe, expect, it } from 'vitest';
import { docstubeWorkspacePackages } from './core.ts';

describe('docstubeWorkspacePackages', () => {
  it('keeps the plan-defined core package in the workspace list', () => {
    expect(docstubeWorkspacePackages).toContain('@docstube/core');
  });
});
