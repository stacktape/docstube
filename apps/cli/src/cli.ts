#!/usr/bin/env node

import { defineCommand, runMain } from 'citty';

const docstubeVersion = '0.0.2';

const generate = defineCommand({
  meta: {
    description: 'Start the local setup wizard and generation control plane.',
    name: 'generate'
  },
  async run() {
    const { startGenerateSession } = await import('@docstube/core');
    const started = await startGenerateSession();
    console.info(`docstube local UI: ${started.url}`);
  }
});

const main = defineCommand({
  meta: {
    description: 'Generate verified, always-current documentation from source code.',
    name: 'docstube',
    version: docstubeVersion
  },
  subCommands: {
    generate
  },
  run: () => {
    console.info('Run `docstube generate` to start the local control plane.');
  }
});

runMain(main);
