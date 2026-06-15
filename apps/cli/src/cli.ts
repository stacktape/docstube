#!/usr/bin/env node

import { defineCommand, runMain } from 'citty';
import { getDocstubePackageInfo } from '@docstube/core';

const main = defineCommand({
  meta: {
    description: 'Generate verified, always-current documentation from source code.',
    name: 'docstube',
    version: getDocstubePackageInfo().version
  },
  run: () => {
    console.info('docstube is scaffolded. Implement commands in S0 order from PLAN.md.');
  }
});

runMain(main);
