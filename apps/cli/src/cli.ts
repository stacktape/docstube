#!/usr/bin/env node

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { defineCommand, runMain } from 'citty';

const docstubeVersion = '0.0.2';

const enableNodeCompileCache = () => {
  if (process.env.NODE_COMPILE_CACHE) {
    return;
  }

  const cacheDir = join(process.cwd(), 'node_modules', '.cache', 'docstube-node-compile-cache');
  mkdirSync(cacheDir, { recursive: true });
  process.env.NODE_COMPILE_CACHE = cacheDir;
};

const output = {
  info: (message: string) => console.info(message),
  error: (message: string) => console.error(message)
};

const commandHelp = [
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

const printHelp = (command?: string): void => {
  if (!command) {
    output.info(commandHelp);
    return;
  }

  const helpByCommand: Record<string, string> = {
    wizard: 'Usage: docstube wizard [--fresh]\n\nOpen the local setup wizard and control plane.',
    generate: 'Usage: docstube generate [--fresh] [--config <path>]\n\nGenerate docs from existing config.',
    refresh: 'Usage: docstube refresh [--config <path>]\n\nRefresh all stale pages and vendored theme assets.',
    refine:
      'Usage: docstube refine [page] [--failed] [--max-rounds <n>]\n\nImprove the lowest-quality generated pages first.',
    validate: 'Usage: docstube validate [--config <path>]\n\nValidate the docstube config family.',
    check:
      'Usage: docstube check --all\n       docstube check <d2|mdx|snippet|config> <file>\n\nRun deterministic checks.',
    status: 'Usage: docstube status\n\nShow config, manifest, and page status.',
    doctor: 'Usage: docstube doctor\n\nCheck local runtime and project setup.',
    upgrade: 'Usage: docstube upgrade [--check] [--to <version>]\n\nUpgrade the docstube tool itself.',
    version: 'Usage: docstube version\n\nPrint the docstube version.'
  };

  output.info(helpByCommand[command] ?? `Unknown help topic: ${command}`);
};

const wizard = defineCommand({
  meta: {
    description: 'Start the local setup wizard and generation control plane.',
    name: 'wizard'
  },
  args: {
    fresh: { type: 'boolean', description: 'Discard local wizard state before starting.' }
  },
  async run({ args }) {
    enableNodeCompileCache();
    const { runWizardCommand } = await import('./cli-commands.ts');
    const result = await runWizardCommand(
      {
        fresh: args.fresh === true,
        uiDevServerUrl: process.env.DOCSTUBE_UI_DEV_SERVER_URL
      },
      output
    );
    process.exitCode = result.exitCode;
  }
});

const generate = defineCommand({
  meta: {
    description: 'Generate docs from existing config.',
    name: 'generate'
  },
  args: {
    fresh: { type: 'boolean', description: 'Discard local generation state before starting.' },
    config: { type: 'string', description: 'Path to docstube.yml.' }
  },
  async run({ args }) {
    enableNodeCompileCache();
    const { runGenerateCommand } = await import('./cli-commands.ts');
    const result = await runGenerateCommand(
      {
        configPath: typeof args.config === 'string' ? args.config : undefined,
        fresh: args.fresh === true
      },
      output
    );
    process.exitCode = result.exitCode;
  }
});

const refresh = defineCommand({
  meta: {
    description: 'Refresh stale pages and vendored theme assets.',
    name: 'refresh'
  },
  args: {
    config: { type: 'string', description: 'Path to docstube.yml.' }
  },
  async run({ args }) {
    enableNodeCompileCache();
    const { runRefreshCommand } = await import('./cli-commands.ts');
    const result = await runRefreshCommand(
      {
        configPath: typeof args.config === 'string' ? args.config : undefined
      },
      output
    );
    process.exitCode = result.exitCode;
  }
});

const refine = defineCommand({
  meta: {
    description: 'Improve the lowest-quality generated pages first.',
    name: 'refine'
  },
  args: {
    target: { type: 'positional', required: false, description: 'Optional page path or page id to refine.' },
    failed: { type: 'boolean', description: 'Consider only pages with failing checks.' },
    'max-rounds': { type: 'string', description: 'Maximum refinement rounds.' }
  },
  async run({ args }) {
    enableNodeCompileCache();
    const maxRounds = typeof args['max-rounds'] === 'string' ? Number(args['max-rounds']) : undefined;
    if (maxRounds !== undefined && (!Number.isInteger(maxRounds) || maxRounds < 1)) {
      output.error(`Invalid --max-rounds value: ${args['max-rounds']}`);
      process.exitCode = 1;
      return;
    }

    const { runRefineCommand } = await import('./cli-commands.ts');
    const result = await runRefineCommand(
      {
        failed: args.failed === true,
        maxRounds,
        target: typeof args.target === 'string' ? args.target : undefined
      },
      output
    );
    process.exitCode = result.exitCode;
  }
});

const validate = defineCommand({
  meta: {
    description: 'Validate the docstube config family.',
    name: 'validate'
  },
  args: {
    config: { type: 'string', description: 'Path to docstube.yml.' }
  },
  async run({ args }) {
    enableNodeCompileCache();
    const { runValidateCommand } = await import('./cli-commands.ts');
    const result = await runValidateCommand(
      {
        configPath: typeof args.config === 'string' ? args.config : undefined
      },
      output
    );
    process.exitCode = result.exitCode;
  }
});

const check = defineCommand({
  meta: {
    description: 'Run one deterministic check.',
    name: 'check'
  },
  args: {
    kind: { type: 'positional', required: false, description: 'd2, mdx, snippet, or config' },
    file: { type: 'positional', required: false, description: 'File to check' },
    all: { type: 'boolean', description: 'Run all deterministic checks for the project.' }
  },
  async run({ args }) {
    enableNodeCompileCache();
    if (args.all === true) {
      const { runCheckAllCommand } = await import('./cli-commands.ts');
      const result = await runCheckAllCommand({}, output);
      process.exitCode = result.exitCode;
      return;
    }

    const kind = args.kind;
    if (kind !== 'd2' && kind !== 'mdx' && kind !== 'snippet' && kind !== 'config') {
      output.error('Expected `docstube check --all` or `docstube check <d2|mdx|snippet|config> <file>`.');
      process.exitCode = 1;
      return;
    }

    if (typeof args.file !== 'string') {
      output.error(`Missing file for check kind: ${kind}`);
      process.exitCode = 1;
      return;
    }

    const { runCheckCommand } = await import('./cli-commands.ts');
    const result = await runCheckCommand({ kind, file: args.file }, output);
    process.exitCode = result.exitCode;
  }
});

const status = defineCommand({
  meta: {
    description: 'Show config, manifest, and page status.',
    name: 'status'
  },
  async run() {
    enableNodeCompileCache();
    const { runStatusCommand } = await import('./cli-commands.ts');
    const result = await runStatusCommand({}, output);
    process.exitCode = result.exitCode;
  }
});

const doctor = defineCommand({
  meta: {
    description: 'Check local runtime and project setup.',
    name: 'doctor'
  },
  async run() {
    enableNodeCompileCache();
    const { runDoctorCommand } = await import('./cli-commands.ts');
    const result = await runDoctorCommand({}, output);
    process.exitCode = result.exitCode;
  }
});

const upgrade = defineCommand({
  meta: {
    description: 'Upgrade the docstube tool itself.',
    name: 'upgrade'
  },
  args: {
    check: { type: 'boolean', description: 'Only check the current version.' },
    to: { type: 'string', description: 'Target version. Defaults to latest.' }
  },
  async run({ args }) {
    enableNodeCompileCache();
    const { runUpgradeCommand } = await import('./cli-commands.ts');
    const result = await runUpgradeCommand(
      {
        check: args.check === true,
        targetVersion: typeof args.to === 'string' ? args.to : undefined
      },
      output
    );
    process.exitCode = result.exitCode;
  }
});

const version = defineCommand({
  meta: {
    description: 'Print the docstube version.',
    name: 'version'
  },
  run: () => {
    output.info(docstubeVersion);
  }
});

const help = defineCommand({
  meta: {
    description: 'Print command help.',
    name: 'help'
  },
  args: {
    command: { type: 'positional', required: false, description: 'Command to describe.' }
  },
  run({ args }) {
    printHelp(typeof args.command === 'string' ? args.command : undefined);
  }
});

const main = defineCommand({
  meta: {
    description: 'Generate verified, always-current documentation from source code.',
    name: 'docstube',
    version: docstubeVersion
  },
  subCommands: {
    wizard,
    generate,
    refresh,
    refine,
    validate,
    check,
    status,
    doctor,
    upgrade,
    version,
    help
  },
  run: ({ rawArgs }) => {
    if (rawArgs.length === 0) {
      printHelp();
    }
  }
});

runMain(main);
