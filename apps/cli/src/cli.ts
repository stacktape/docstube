#!/usr/bin/env node

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { defineCommand, runMain } from 'citty';
import { getCommandHelp } from './cli-help.ts';

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

const printHelp = (command?: string): void => {
  output.info(getCommandHelp(command));
};

const runCliCommand = async (
  command: string,
  run: () => Promise<{ exitCode: number }> | { exitCode: number }
): Promise<void> => {
  const { runCliCommandWithTelemetry } = await import('./runtime-telemetry.ts');
  const result = await runCliCommandWithTelemetry({
    command,
    run,
    workspaceDir: process.cwd()
  });
  process.exitCode = result.exitCode;
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
    await runCliCommand('wizard', async () => {
      enableNodeCompileCache();
      const { runWizardCommand } = await import('./commands/wizard-command.ts');
      return runWizardCommand(
        {
          fresh: args.fresh === true,
          uiDevServerUrl: process.env.DOCSTUBE_UI_DEV_SERVER_URL
        },
        output
      );
    });
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
    await runCliCommand('generate', async () => {
      enableNodeCompileCache();
      const { runGenerateCommand } = await import('./commands/generate-command.ts');
      return runGenerateCommand(
        {
          configPath: typeof args.config === 'string' ? args.config : undefined,
          fresh: args.fresh === true
        },
        output
      );
    });
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
    await runCliCommand('refresh', async () => {
      enableNodeCompileCache();
      const { runRefreshCommand } = await import('./commands/refresh-command.ts');
      return runRefreshCommand(
        {
          configPath: typeof args.config === 'string' ? args.config : undefined
        },
        output
      );
    });
  }
});

const refine = defineCommand({
  meta: {
    description: 'Improve the lowest-quality generated pages first.',
    name: 'refine'
  },
  args: {
    target: { type: 'positional', required: false, description: 'Optional page path or page id to refine.' },
    config: { type: 'string', description: 'Path to docstube.yml.' },
    failed: { type: 'boolean', description: 'Consider only pages with failing checks.' },
    'max-rounds': { type: 'string', description: 'Maximum refinement rounds.' }
  },
  async run({ args }) {
    await runCliCommand('refine', async () => {
      enableNodeCompileCache();
      const maxRounds = typeof args['max-rounds'] === 'string' ? Number(args['max-rounds']) : undefined;
      if (maxRounds !== undefined && (!Number.isInteger(maxRounds) || maxRounds < 1)) {
        output.error(`Invalid --max-rounds value: ${args['max-rounds']}`);
        return { exitCode: 1 };
      }

      const { runRefineCommand } = await import('./commands/refine-command.ts');
      return runRefineCommand(
        {
          configPath: typeof args.config === 'string' ? args.config : undefined,
          failed: args.failed === true,
          maxRounds,
          target: typeof args.target === 'string' ? args.target : undefined
        },
        output
      );
    });
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
    await runCliCommand('validate', async () => {
      enableNodeCompileCache();
      const { runValidateCommand } = await import('./commands/validate-command.ts');
      return runValidateCommand(
        {
          configPath: typeof args.config === 'string' ? args.config : undefined
        },
        output
      );
    });
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
    all: { type: 'boolean', description: 'Run all deterministic checks for the project.' },
    config: { type: 'string', description: 'Path to docstube.yml for --all.' }
  },
  async run({ args }) {
    await runCliCommand('check', async () => {
      enableNodeCompileCache();
      if (args.all === true) {
        const { runCheckAllCommand } = await import('./commands/check-command.ts');
        return runCheckAllCommand(
          {
            configPath: typeof args.config === 'string' ? args.config : undefined
          },
          output
        );
      }

      const kind = args.kind;
      if (kind !== 'd2' && kind !== 'mdx' && kind !== 'snippet' && kind !== 'config') {
        output.error('Expected `docstube check --all` or `docstube check <d2|mdx|snippet|config> <file>`.');
        return { exitCode: 1 };
      }

      if (typeof args.file !== 'string') {
        output.error(`Missing file for check kind: ${kind}`);
        return { exitCode: 1 };
      }

      const { runCheckCommand } = await import('./commands/check-command.ts');
      return runCheckCommand({ kind, file: args.file }, output);
    });
  }
});

const status = defineCommand({
  meta: {
    description: 'Show config, manifest, and page status.',
    name: 'status'
  },
  args: {
    config: { type: 'string', description: 'Path to docstube.yml.' }
  },
  async run({ args }) {
    await runCliCommand('status', async () => {
      enableNodeCompileCache();
      const { runStatusCommand } = await import('./commands/status-command.ts');
      return runStatusCommand(
        {
          configPath: typeof args.config === 'string' ? args.config : undefined
        },
        output
      );
    });
  }
});

const doctor = defineCommand({
  meta: {
    description: 'Check local runtime and project setup.',
    name: 'doctor'
  },
  args: {
    config: { type: 'string', description: 'Path to docstube.yml.' }
  },
  async run({ args }) {
    await runCliCommand('doctor', async () => {
      enableNodeCompileCache();
      const { runDoctorCommand } = await import('./commands/doctor-command.ts');
      return runDoctorCommand(
        {
          configPath: typeof args.config === 'string' ? args.config : undefined
        },
        output
      );
    });
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
    await runCliCommand('upgrade', async () => {
      enableNodeCompileCache();
      const { runUpgradeCommand } = await import('./commands/upgrade-command.ts');
      return runUpgradeCommand(
        {
          check: args.check === true,
          targetVersion: typeof args.to === 'string' ? args.to : undefined
        },
        output
      );
    });
  }
});

const version = defineCommand({
  meta: {
    description: 'Print the docstube version.',
    name: 'version'
  },
  async run() {
    await runCliCommand('version', () => {
      output.info(docstubeVersion);
      return { exitCode: 0 };
    });
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
  async run({ args }) {
    await runCliCommand('help', () => {
      printHelp(typeof args.command === 'string' ? args.command : undefined);
      return { exitCode: 0 };
    });
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
