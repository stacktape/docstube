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

const generate = defineCommand({
  meta: {
    description: 'Start the local setup wizard and generation control plane.',
    name: 'generate'
  },
  args: {
    yes: { type: 'boolean', description: 'Run without setup questions.' },
    fresh: { type: 'boolean', description: 'Discard local machine state before starting.' },
    'no-open': { type: 'boolean', description: 'Print the local URL without opening a browser.' }
  },
  async run({ args }) {
    enableNodeCompileCache();
    const { runGenerateCommand } = await import('./cli-commands.ts');
    const result = await runGenerateCommand(
      {
        yes: args.yes === true,
        fresh: args.fresh === true,
        openBrowser: args['no-open'] === true ? () => {} : undefined,
        uiDevServerUrl: process.env.DOCSTUBE_UI_DEV_SERVER_URL
      },
      output
    );
    process.exitCode = result.exitCode;
  }
});

const update = defineCommand({
  meta: {
    description: 'Run an incremental documentation update.',
    name: 'update'
  },
  async run() {
    enableNodeCompileCache();
    const { runUpdateCommand } = await import('./cli-commands.ts');
    const result = await runUpdateCommand({}, output);
    process.exitCode = result.exitCode;
  }
});

const validate = defineCommand({
  meta: {
    description: 'Validate the docstube config family.',
    name: 'validate'
  },
  async run() {
    enableNodeCompileCache();
    const { runValidateCommand } = await import('./cli-commands.ts');
    const result = await runValidateCommand({}, output);
    process.exitCode = result.exitCode;
  }
});

const check = defineCommand({
  meta: {
    description: 'Run one deterministic check.',
    name: 'check'
  },
  args: {
    kind: { type: 'positional', required: true, description: 'd2, mdx, snippet, or config' },
    file: { type: 'positional', required: true, description: 'File to check' }
  },
  async run({ args }) {
    enableNodeCompileCache();
    const kind = args.kind;
    if (kind !== 'd2' && kind !== 'mdx' && kind !== 'snippet' && kind !== 'config') {
      output.error(`Unknown check kind: ${kind}`);
      process.exitCode = 1;
      return;
    }

    const { runCheckCommand } = await import('./cli-commands.ts');
    const result = await runCheckCommand({ kind, file: args.file }, output);
    process.exitCode = result.exitCode;
  }
});

const main = defineCommand({
  meta: {
    description: 'Generate verified, always-current documentation from source code.',
    name: 'docstube',
    version: docstubeVersion
  },
  subCommands: {
    generate,
    update,
    validate,
    check
  },
  run: ({ rawArgs }) => {
    if (rawArgs.length === 0) {
      console.info('Run `docstube generate` to start the local control plane.');
    }
  }
});

runMain(main);
