import { renderUsage } from 'citty';
import type { CommandDef } from 'citty';
import type { CliOutput } from './cli-output.ts';

// ONE help renderer. citty derives the command list, their descriptions, and every argument and
// option straight from the registry in cli-commands.ts, so `docstube help`, `docstube --help`,
// `docstube help <command>` and the unknown-command usage dump are all this file. There is no
// hand-maintained command list to drift out of the registry — an earlier one already had.
//
// The single thing citty cannot derive is that bare `docstube` is itself a command: `default:
// 'wizard'` renders as nothing at all. That paragraph, and only that paragraph, is written here.
const bareInvocationNote = [
  'Run `docstube` with no command to open the local control plane: first-run setup when this',
  'repository has no docstube.yml, the generation dashboard when it does.'
].join('\n');

// `CommandDef` is invariant in its args, and help rendering does not care which args a command has.
// citty's own `SubCommandsDef` erases them the same way.
// oxlint-disable-next-line typescript/no-explicit-any
type HelpCommandDef = CommandDef<any>;

export type RenderedHelp = {
  text: string;
  unknownCommand: boolean;
};

const subCommandsOf = (main: HelpCommandDef): Record<string, HelpCommandDef> =>
  (main.subCommands ?? {}) as Record<string, HelpCommandDef>;

export const renderRootHelp = async (main: HelpCommandDef): Promise<string> =>
  `${await renderUsage(main)}\n\n${bareInvocationNote}`;

export const renderHelp = async (main: HelpCommandDef, command?: string): Promise<RenderedHelp> => {
  if (command === undefined) {
    return { text: await renderRootHelp(main), unknownCommand: false };
  }
  const subCommands = subCommandsOf(main);
  const subCommand = command in subCommands ? subCommands[command] : undefined;
  if (subCommand === undefined) {
    // Same wording citty uses for a typo'd command, so the two paths read identically.
    return { text: `Unknown command ${command}\n\n${await renderRootHelp(main)}`, unknownCommand: true };
  }
  return { text: await renderUsage(subCommand, main), unknownCommand: false };
};

// Handed to citty's `runMain` so the usage it prints for `--help` and for an unknown command is the
// exact same text `docstube help` prints, through the CLI's own output rather than console.log.
export const createUsageRenderer =
  (output: CliOutput) =>
  async (cmd: HelpCommandDef, parent?: HelpCommandDef): Promise<void> => {
    // citty resolves the deepest matched command; no parent means it fell back to the root.
    output.info(parent === undefined ? await renderRootHelp(cmd) : await renderUsage(cmd, parent));
  };
