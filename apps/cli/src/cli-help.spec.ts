import type { CommandDef } from 'citty';
import { describe, expect, it } from 'vitest';
import { mainCommand, subCommands } from './cli-commands.ts';
import { renderHelp } from './cli-help.ts';

// THE drift guard. Help used to be a hand-written list next to the citty registry, and it had
// already drifted once (documenting `--fresh` flags that did not exist). Every assertion here is
// derived from `subCommands`, so a command that is registered but unlisted — or listed but
// unregistered — fails, and a description that lives anywhere but `meta.description` fails.

// citty decides whether to colour its output once, at module load, from the environment. Stripping
// is the only way to read the text back that does not depend on module import order.
const ansiCodes = new RegExp(`${String.fromCodePoint(27)}\\[\\d+m`, 'gu');
const plain = (text: string): string => text.replaceAll(ansiCodes, '');

const registeredCommands = Object.keys(subCommands).toSorted();

const registeredDescription = (name: string): string | undefined =>
  ((subCommands[name] as CommandDef).meta as { description?: string } | undefined)?.description;

// citty renders COMMANDS as a padded two-column block that ends at the next blank line.
const listedCommands = (help: string): { description: string; name: string }[] => {
  const lines = plain(help).split('\n');
  const start = lines.indexOf('COMMANDS');
  if (start === -1) {
    return [];
  }
  const rows: { description: string; name: string }[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '') {
      if (rows.length > 0) {
        break;
      }
      continue;
    }
    const match = /^\s+(?<name>\S+)\s{2,}(?<description>\S.*)$/u.exec(line);
    const name = match?.groups?.name;
    const description = match?.groups?.description;
    if (name === undefined || description === undefined) {
      break;
    }
    rows.push({ description: description.trim(), name });
  }
  return rows;
};

describe('cli help: one source of truth', () => {
  it('lists exactly the registered commands — nothing extra, nothing missing', async () => {
    const rendered = await renderHelp(mainCommand);
    expect(
      listedCommands(rendered.text)
        .map((row) => row.name)
        .toSorted()
    ).toEqual(registeredCommands);
    expect(registeredCommands.length).toBeGreaterThan(10);
  });

  it('takes every listed description from the registry, so descriptions live in one place', async () => {
    const rendered = await renderHelp(mainCommand);
    const listed = Object.fromEntries(listedCommands(rendered.text).map((row) => [row.name, row.description]));
    const registered = Object.fromEntries(registeredCommands.map((name) => [name, registeredDescription(name)]));
    expect(listed).toEqual(registered);
  });

  it('gives every registered command a description and a matching meta name', () => {
    for (const name of registeredCommands) {
      expect({ name, description: registeredDescription(name) }).toEqual({
        name,
        description: expect.stringMatching(/\S/u)
      });
      expect(((subCommands[name] as CommandDef).meta as { name?: string }).name).toBe(name);
    }
  });

  it.each(Object.keys(subCommands))('renders `docstube help %s` from that command definition', async (name) => {
    const rendered = await renderHelp(mainCommand, name);
    expect(rendered.unknownCommand).toBe(false);
    expect(plain(rendered.text)).toContain(`USAGE docstube ${name}`);
  });

  it('explains the bare invocation, which citty cannot derive from `default`', async () => {
    const rendered = await renderHelp(mainCommand);
    expect(rendered.text).toContain('Run `docstube` with no command to open the local control plane');
  });

  it('has NO public refresh command — generate is the one reconciler (pipeline-v2 decision 1)', async () => {
    expect(registeredCommands).not.toContain('refresh');
    const rendered = await renderHelp(mainCommand, 'refresh');
    expect({ unknown: rendered.unknownCommand, mentioned: rendered.text.includes('  refresh') }).toEqual({
      unknown: true,
      mentioned: false
    });
  });

  it('documents check kinds as plugin-derived, not a hardcoded list', async () => {
    const rendered = await renderHelp(mainCommand, 'check');
    expect(rendered.text).toContain('registered verifier plugins');
    expect(rendered.text).not.toMatch(/\b(?:d2|mdx|snippet)\b/u);
  });

  it('falls back to the overview for an unknown command, and says so', async () => {
    const rendered = await renderHelp(mainCommand, 'nope');
    expect(rendered.unknownCommand).toBe(true);
    expect(rendered.text).toContain('Unknown command nope');
    expect(
      listedCommands(rendered.text)
        .map((row) => row.name)
        .toSorted()
    ).toEqual(registeredCommands);
  });
});
