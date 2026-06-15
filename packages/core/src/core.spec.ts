import { describe, expect, it } from 'vitest';
import { docstubeWorkspacePackages } from './core';

describe('docstubeWorkspacePackages', () => {
  it('keeps the plan-defined core package in the workspace list', () => {
    expect(docstubeWorkspacePackages).toContain('@docstube/core');
  });
});
