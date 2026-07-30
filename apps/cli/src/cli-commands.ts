import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { defineCommand } from 'citty';
import type { SubCommandsDef } from 'citty';
import { renderHelp } from './cli-help.ts';
import { defaultOutput } from './cli-output.ts';
import type { CliCommandResult } from './cli-output.ts';
import { docstubeVersion } from './cli-version.ts';

// THE command registry. `meta.description` here is the ONLY place a command's one-line description
// lives: `docstube help`, `docstube --help`, `docstube help <command>` and the unknown-command
// usage dump all render from this object, so a command cannot be listed-but-unregistered or
// registered-but-unlisted. Do not re-describe commands anywhere else.

const enableNodeCompileCache = () => {
  if (process.env.NODE_COMPILE_CACHE) {
    return;
  }
  const cacheDir = join(process.cwd(), 'node_modules', '.cache', 'docstube-node-compile-cache');
  mkdirSync(cacheDir, { recursive: true });
  process.env.NODE_COMPILE_CACHE = cacheDir;
};

const output = defaultOutput;

const runCliCommand = async (
  command: string,
  run: () => Promise<CliCommandResult> | CliCommandResult
): Promise<void> => {
  const { runCliCommandWithTelemetry } = await import('./runtime-telemetry.ts');
  const result = await runCliCommandWithTelemetry({
    command,
    onDisclosure: output.info,
    run,
    workspaceDir: process.cwd()
  });
  process.exitCode = result.exitCode;
};

const generate = defineCommand({
  meta: {
    description: 'Generate docs from existing config (idempotent — later runs do only the affected work).',
    name: 'generate'
  },
  args: {
    'max-attempts': { type: 'string', description: 'Max write attempts per page (default 3).' },
    ci: { type: 'boolean', description: 'Emit the fail-closed publication decision the GitHub Action enforces.' }
  },
  async run({ args }) {
    await runCliCommand('generate', async () => {
      enableNodeCompileCache();
      const maxAttempts = typeof args['max-attempts'] === 'string' ? Number(args['max-attempts']) : undefined;
      if (maxAttempts !== undefined && (!Number.isInteger(maxAttempts) || maxAttempts < 1)) {
        output.error(`Invalid --max-attempts value: ${args['max-attempts']}`);
        return { exitCode: 1 };
      }
      const { runGenerateCommand } = await import('./commands/generate-command.ts');
      return runGenerateCommand({ workspaceDir: process.cwd(), maxAttempts, ci: args.ci === true }, output);
    });
  }
});

const preview = defineCommand({
  meta: { description: 'Build (when stale) and serve the generated docs site locally.', name: 'preview' },
  args: {
    port: { type: 'string', description: 'Port to serve on (default: random free port).' },
    build: { type: 'boolean', description: 'Force a rebuild even when the site looks fresh.' }
  },
  async run({ args }) {
    await runCliCommand('preview', async () => {
      const port = typeof args.port === 'string' ? Number(args.port) : undefined;
      if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65_535)) {
        output.error(`Invalid --port value: ${args.port}`);
        return { exitCode: 1 };
      }
      const { runPreviewCommand } = await import('./commands/preview-command.ts');
      return runPreviewCommand({ workspaceDir: process.cwd(), port, build: args.build === true }, output);
    });
  }
});

// Shared by `docstube wizard` and bare `docstube` — one context-aware entry point (PRODUCT §3.9.1):
// no config → first-run setup, config → dashboard, TTY-safe, `--no-open` always available.
const controlPlaneArgs = {
  port: { type: 'string', description: 'Port for the local control plane (default: random).' },
  'no-open': { type: 'boolean', description: 'Print the URL instead of opening a browser.' }
} as const;

const runControlPlane = async (args: { port?: unknown; 'no-open'?: unknown }): Promise<CliCommandResult> => {
  enableNodeCompileCache();
  const port = typeof args.port === 'string' ? Number(args.port) : undefined;
  if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65_535)) {
    output.error(`Invalid --port value: ${String(args.port)}`);
    return { exitCode: 1 };
  }
  const { runWizardCommand } = await import('./commands/wizard-command.ts');
  return runWizardCommand(
    {
      workspaceDir: process.cwd(),
      uiDevServerUrl: process.env.DOCSTUBE_UI_DEV_SERVER_URL,
      port,
      ...(args['no-open'] === true ? { open: false } : {})
    },
    output
  );
};

const wizard = defineCommand({
  meta: {
    description: 'Open the local setup wizard and control plane (what bare `docstube` runs).',
    name: 'wizard'
  },
  args: controlPlaneArgs,
  async run({ args }) {
    await runCliCommand('wizard', () => runControlPlane(args));
  }
});

const plugin = defineCommand({
  meta: { description: 'Scaffold and manage docstube plugins.', name: 'plugin' },
  args: {
    action: { type: 'positional', required: true, description: 'scaffold' },
    name: { type: 'positional', required: false, description: 'Plugin name (e.g. wordcount).' }
  },
  async run({ args }) {
    await runCliCommand('plugin', async () => {
      enableNodeCompileCache();
      const { runPluginCommand } = await import('./commands/plugin-command.ts');
      return runPluginCommand(
        {
          workspaceDir: process.cwd(),
          action: String(args.action),
          name: typeof args.name === 'string' ? args.name : undefined
        },
        output
      );
    });
  }
});

// `refresh` is REMOVED as a public command (pipeline-v2 decision 1): `docstube generate` is the
// one idempotent reconciler; the maintain engine survives only as internals generate will call.
const refine = defineCommand({
  meta: { description: 'Improve the lowest-quality generated pages first.', name: 'refine' },
  args: {
    target: { type: 'positional', required: false, description: 'Page slug to refine.' },
    failed: { type: 'boolean', description: 'Consider only pages with open flags.' },
    'max-pages': { type: 'string', description: 'Max pages refined this run (default 3).' },
    'max-rounds-per-page': { type: 'string', description: 'Max rewrite rounds per page (default 3).' },
    'total-rounds': { type: 'string', description: 'Global rewrite-round budget for the whole run.' }
  },
  async run({ args }) {
    await runCliCommand('refine', async () => {
      enableNodeCompileCache();
      const parsePositive = (name: string): number | undefined | null => {
        const raw = args[name as keyof typeof args];
        if (typeof raw !== 'string') {
          return undefined;
        }
        const value = Number(raw);
        if (!Number.isInteger(value) || value < 1) {
          output.error(`Invalid --${name} value: ${raw}`);
          return null;
        }
        return value;
      };
      const maxPages = parsePositive('max-pages');
      const maxRoundsPerPage = parsePositive('max-rounds-per-page');
      const totalRounds = parsePositive('total-rounds');
      if (maxPages === null || maxRoundsPerPage === null || totalRounds === null) {
        return { exitCode: 1 };
      }
      const { runRefineCommand } = await import('./commands/refine-command.ts');
      return runRefineCommand(
        {
          workspaceDir: process.cwd(),
          target: typeof args.target === 'string' ? args.target : undefined,
          failedOnly: args.failed === true,
          maxPages,
          maxRoundsPerPage,
          totalRounds
        },
        output
      );
    });
  }
});

const audit = defineCommand({
  meta: {
    description: 'Measure verified defects in any existing docs site (claims extracted, then verified).',
    name: 'audit'
  },
  args: {
    'docs-dir': { type: 'positional', required: true, description: 'Directory containing the docs to audit (md/mdx).' },
    json: { type: 'boolean', description: 'Emit the report as JSON.' }
  },
  async run({ args }) {
    await runCliCommand('audit', async () => {
      enableNodeCompileCache();
      const { runAuditCommand } = await import('./commands/audit-command.ts');
      return runAuditCommand(
        { workspaceDir: process.cwd(), docsDir: String(args['docs-dir']), json: args.json === true },
        output
      );
    });
  }
});

const answer = defineCommand({
  meta: { description: 'List and answer open maintainer questions (tribal knowledge).', name: 'answer' },
  args: {
    id: { type: 'positional', required: false, description: 'Question id from `docstube answer`.' },
    text: { type: 'positional', required: false, description: 'The answer text (quote it).' }
  },
  async run({ args }) {
    await runCliCommand('answer', async () => {
      enableNodeCompileCache();
      const { runAnswerCommand } = await import('./commands/answer-command.ts');
      return runAnswerCommand(
        {
          workspaceDir: process.cwd(),
          flagId: typeof args.id === 'string' ? args.id : undefined,
          text: typeof args.text === 'string' ? args.text : undefined
        },
        output
      );
    });
  }
});

const validate = defineCommand({
  meta: { description: 'Validate the docstube config family.', name: 'validate' },
  async run() {
    await runCliCommand('validate', async () => {
      enableNodeCompileCache();
      const { runValidateCommand } = await import('./commands/validate-command.ts');
      return runValidateCommand({ workspaceDir: process.cwd() }, output);
    });
  }
});

const check = defineCommand({
  meta: { description: 'Run deterministic checks; kinds derive from registered verifier plugins.', name: 'check' },
  args: {
    kind: { type: 'positional', required: false, description: 'Verifier id (see `docstube check --list`).' },
    list: { type: 'boolean', description: 'List the checks registered in this project.' }
  },
  async run({ args }) {
    await runCliCommand('check', async () => {
      enableNodeCompileCache();
      const { runCheckCommand } = await import('./commands/check-command.ts');
      return runCheckCommand(
        {
          workspaceDir: process.cwd(),
          kind: typeof args.kind === 'string' ? args.kind : undefined,
          list: args.list === true
        },
        output
      );
    });
  }
});

const status = defineCommand({
  meta: { description: 'Show manifest, claim counts, and open flags.', name: 'status' },
  async run() {
    await runCliCommand('status', async () => {
      enableNodeCompileCache();
      const { runStatusCommand } = await import('./commands/status-command.ts');
      return runStatusCommand({ workspaceDir: process.cwd() }, output);
    });
  }
});

const doctor = defineCommand({
  meta: { description: 'Check local runtime and project setup.', name: 'doctor' },
  args: {
    ci: {
      type: 'boolean',
      description:
        'Run the CI preflight (transport auth, GitHub permissions, auto-merge preconditions, branch state) before any model spend; exits non-zero on a blocking check. Checks that cannot be performed report `unknown`, never a pass.'
    },
    json: { type: 'boolean', description: 'Emit the versioned preflight report as JSON (what the Action consumes).' }
  },
  async run({ args }) {
    await runCliCommand('doctor', async () => {
      enableNodeCompileCache();
      const { runDoctorCommand } = await import('./commands/doctor-command.ts');
      return runDoctorCommand({ workspaceDir: process.cwd(), ci: args.ci === true, json: args.json === true }, output);
    });
  }
});

const upgrade = defineCommand({
  meta: { description: 'Upgrade the docstube tool itself.', name: 'upgrade' },
  args: {
    check: { type: 'boolean', description: 'Only check the current version.' },
    to: { type: 'string', description: 'Target version. Defaults to latest.' }
  },
  async run({ args }) {
    await runCliCommand('upgrade', async () => {
      enableNodeCompileCache();
      const { runUpgradeCommand } = await import('./commands/upgrade-command.ts');
      return runUpgradeCommand(
        { check: args.check === true, targetVersion: typeof args.to === 'string' ? args.to : undefined },
        output
      );
    });
  }
});

const version = defineCommand({
  meta: { description: 'Print the docstube version.', name: 'version' },
  async run() {
    await runCliCommand('version', () => {
      output.info(docstubeVersion);
      return { exitCode: 0 };
    });
  }
});

const help = defineCommand({
  meta: { description: 'Print command help.', name: 'help' },
  args: {
    command: { type: 'positional', required: false, description: 'Command to describe.' }
  },
  async run({ args }) {
    await runCliCommand('help', async () => {
      // `mainCommand` is initialised by the time any command runs, so the cycle is only lexical.
      const rendered = await renderHelp(mainCommand, typeof args.command === 'string' ? args.command : undefined);
      if (rendered.unknownCommand) {
        output.error(rendered.text);
        return { exitCode: 1 };
      }
      output.info(rendered.text);
      return { exitCode: 0 };
    });
  }
});

// Null prototype on purpose: citty resolves a subcommand with `name in subCommands`, so with a
// normal object literal `docstube constructor` would resolve Object.prototype.constructor and run
// as if it were a command instead of failing as the typo it is.
export const subCommands: SubCommandsDef = Object.assign(Object.create(null) as SubCommandsDef, {
  wizard,
  generate,
  refine,
  preview,
  audit,
  answer,
  plugin,
  validate,
  check,
  status,
  doctor,
  upgrade,
  version,
  help
});

export const mainCommand = defineCommand({
  meta: {
    description: 'Verified docs, generated from your code.',
    name: 'docstube',
    version: docstubeVersion
  },
  args: controlPlaneArgs,
  subCommands,
  // Bare `docstube` IS `docstube wizard` (PRODUCT §3.9.1). This MUST stay a `default` and must
  // never become a root `run`: citty runs a parent's `run` *in addition to* the matched
  // subcommand, so a root handler here made every successful `docstube <command>` exit 1
  // afterwards. citty already rejects a positional that is not a subcommand
  // (E_UNKNOWN_COMMAND -> usage + exit 1), so a typo still never opens the control plane.
  default: 'wizard'
});
