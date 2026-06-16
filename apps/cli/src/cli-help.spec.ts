import { describe, expect, it } from 'vitest';
import { commandHelp, commandHelpByCommand, getCommandHelp } from './cli-help.ts';

describe('CLI help surface', () => {
  it('pins the public command names and command-specific usage', () => {
    expect(Object.keys(commandHelpByCommand)).toEqual([
      'wizard',
      'generate',
      'refresh',
      'refine',
      'validate',
      'check',
      'status',
      'doctor',
      'upgrade',
      'version'
    ]);
    expect(commandHelp).toContain('wizard');
    expect(getCommandHelp('wizard')).toContain('docstube wizard [--fresh]');
    expect(getCommandHelp('refine')).toContain('[--config <path>]');
    expect(getCommandHelp('check')).toContain('docstube check --all [--config <path>]');
    expect(getCommandHelp('status')).toContain('docstube status [--config <path>]');
    expect(getCommandHelp('doctor')).toContain('docstube doctor [--config <path>]');
  });

  it('does not advertise removed command concepts', () => {
    const help = [commandHelp, ...Object.values(commandHelpByCommand)].join('\n');

    expect(help).not.toContain('--no-open');
    expect(help).not.toContain('upgrade --project');
    expect(help).not.toContain('docstube update');
    expect(help).not.toContain('refine [page] [--all]');
  });
});
