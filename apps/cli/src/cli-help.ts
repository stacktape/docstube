export const commandHelp = [
  'Usage: docstube <command> [options]',
  '',
  'Commands:',
  '  wizard                 Open the local setup wizard and control plane.',
  '  generate               Generate docs from existing config (idempotent — later runs do only the affected work).',
  '  refine                 Improve the lowest-quality generated pages first.',
  '  preview                Build (when stale) and serve the generated docs site locally.',
  '  audit                  Measure verified defects in any existing docs site.',
  '  answer                 List and answer open maintainer questions.',
  '  validate               Validate the docstube config family.',
  '  check [kind]           Run deterministic checks (kinds come from registered verifier plugins).',
  '  status                 Show manifest, guarantee levels, and open flags.',
  '  doctor                 Check local runtime and project setup.',
  '  plugin                 Scaffold and manage docstube plugins.',
  '  upgrade                Upgrade the docstube tool itself.',
  '  version                Print the docstube version.',
  '  help [command]         Print command help.'
].join('\n');

export const commandHelpByCommand: Record<string, string> = {
  wizard: 'Usage: docstube wizard [--port <n>]\n\nOpen the local setup wizard and control plane.',
  generate:
    'Usage: docstube generate [--max-attempts <n>]\n\nGenerate docs from existing config. Idempotent reconciler: the first run generates everything; later runs redo only affected work.',
  refine:
    'Usage: docstube refine [page] [--failed] [--max-pages <n>] [--max-rounds-per-page <n>] [--total-rounds <n>]\n\nImprove the lowest-quality generated pages first.',
  audit:
    'Usage: docstube audit <docs-dir> [--json]\n\nExtract claims from an existing docs site and verify them against the codebase.',
  preview:
    'Usage: docstube preview [--port <n>] [--build]\n\nBuild the generated site when its content changed (npm handled automatically), then serve it on localhost and open the browser. --build forces a rebuild.',
  validate: 'Usage: docstube validate\n\nValidate the docstube config family.',
  check:
    'Usage: docstube check [kind]\n       docstube check --list\n\nRun deterministic checks over the generated docs. Kinds derive from registered verifier plugins.',
  status: 'Usage: docstube status\n\nShow manifest, guarantee levels, and open flags.',
  doctor: 'Usage: docstube doctor\n\nCheck local runtime and project setup.',
  answer:
    'Usage: docstube answer\n       docstube answer <id> "your answer"\n\nList open maintainer questions (tribal knowledge) and answer them.',
  plugin: 'Usage: docstube plugin scaffold <name>\n\nScaffold a docstube plugin (uses the plugin-authoring skill).',
  upgrade: 'Usage: docstube upgrade [--check] [--to <version>]\n\nUpgrade the docstube tool itself.',
  version: 'Usage: docstube version\n\nPrint the docstube version.'
};

export const getCommandHelp = (command?: string): string => {
  if (command === undefined) {
    return commandHelp;
  }
  return commandHelpByCommand[command] ?? `Unknown command: ${command}\n\n${commandHelp}`;
};
