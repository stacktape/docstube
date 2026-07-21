import { describe, expect, it } from 'vitest';
import { getCommandHelp } from './cli-help.ts';

describe('cli help', () => {
  it('lists the full v1 command surface', () => {
    const help = getCommandHelp();
    for (const command of [
      'wizard',
      'generate',
      'refine',
      'audit',
      'validate',
      'check',
      'status',
      'doctor',
      'plugin',
      'upgrade'
    ]) {
      expect(help).toContain(`  ${command}`);
    }
  });

  it('has NO public refresh command — generate is the one reconciler (pipeline-v2 decision 1)', () => {
    expect(getCommandHelp()).not.toContain('refresh');
    expect(getCommandHelp('refresh')).toContain('Unknown command: refresh');
  });

  it('documents check kinds as plugin-derived, not a hardcoded list', () => {
    expect(getCommandHelp('check')).toContain('registered verifier plugins');
    expect(getCommandHelp('check')).not.toMatch(/d2\|mdx\|snippet\|config/);
  });

  it('falls back to the overview for unknown commands', () => {
    expect(getCommandHelp('nope')).toContain('Unknown command: nope');
  });
});
