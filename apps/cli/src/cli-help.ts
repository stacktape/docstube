export const commandHelp = [
  'Usage: docstube <command> [options]',
  '',
  'Commands:',
  '  wizard                 Open the local setup wizard and control plane.',
  '  generate               Generate docs from existing config.',
  '  refresh                Refresh stale pages and vendored theme assets.',
  '  refine                 Improve the lowest-quality generated pages first.',
  '  validate               Validate the docstube config family.',
  '  check                  Run deterministic checks.',
  '  status                 Show config, manifest, and page status.',
  '  doctor                 Check local runtime and project setup.',
  '  upgrade                Upgrade the docstube tool itself.',
  '  version                Print the docstube version.',
  '  help [command]         Print command help.'
].join('\n');

export const commandHelpByCommand = {
  wizard: 'Usage: docstube wizard [--fresh]\n\nOpen the local setup wizard and control plane.',
  generate: 'Usage: docstube generate [--fresh] [--config <path>]\n\nGenerate docs from existing config.',
  refresh: 'Usage: docstube refresh [--config <path>]\n\nRefresh all stale pages and vendored theme assets.',
  refine:
    'Usage: docstube refine [page] [--failed] [--max-rounds <n>] [--config <path>]\n\nImprove the lowest-quality generated pages first.',
  validate: 'Usage: docstube validate [--config <path>]\n\nValidate the docstube config family.',
  check:
    'Usage: docstube check --all [--config <path>]\n       docstube check <d2|mdx|snippet|config> <file>\n\nRun deterministic checks.',
  status: 'Usage: docstube status [--config <path>]\n\nShow config, manifest, and page status.',
  doctor: 'Usage: docstube doctor [--config <path>]\n\nCheck local runtime and project setup.',
  upgrade: 'Usage: docstube upgrade [--check] [--to <version>]\n\nUpgrade the docstube tool itself.',
  version: 'Usage: docstube version\n\nPrint the docstube version.'
};

export type HelpTopic = keyof typeof commandHelpByCommand;

export const getCommandHelp = (command?: string): string => {
  if (!command) {
    return commandHelp;
  }

  return command in commandHelpByCommand
    ? commandHelpByCommand[command as HelpTopic]
    : `Unknown help topic: ${command}`;
};
