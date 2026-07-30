#!/usr/bin/env node

import { runMain } from 'citty';
import { mainCommand } from './cli-commands.ts';
import { createUsageRenderer } from './cli-help.ts';
import { defaultOutput } from './cli-output.ts';

runMain(mainCommand, { showUsage: createUsageRenderer(defaultOutput) });
