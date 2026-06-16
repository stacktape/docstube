import { execFile } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

export type GitHubActionCommand = {
  configPath?: string;
  cwd: string;
  mode: 'generate' | 'update' | 'validate';
};

export type GitHubActionMode = 'update' | 'validate';

export type GitHubActionChangedPage = {
  path: string;
  reasons: readonly string[];
};

export type GitHubActionInputs = {
  baseBranch?: string;
  branchPrefix?: string;
  commitMessage?: string;
  configPath?: string;
  docstubePackage?: string;
  dryRun?: boolean;
  githubToken?: string;
  mode?: GitHubActionMode;
  refName?: string;
  workspaceDir: string;
  workflowName?: string;
};

export type DocstubeActionCommandInput = {
  configPath?: string;
  workspaceDir: string;
};

export type DocstubeActionCommandResult = {
  changedPages?: readonly GitHubActionChangedPage[];
  exitCode: number;
  output?: string;
};

export type GitHubPullRequest = {
  number?: number;
  url: string;
};

export type GitCheckoutInput = {
  baseBranch: string;
  workspaceDir: string;
};

export type GitBranchInput = {
  branchName: string;
  workspaceDir: string;
};

export type GitCommitInput = {
  message: string;
  workspaceDir: string;
};

export type PullRequestInput = {
  baseBranch: string;
  body: string;
  branchName: string;
  title: string;
  workspaceDir: string;
};

export type GitHubActionGitClient = {
  changedFiles: (input: { workspaceDir: string }) => Promise<readonly string[]>;
  checkoutBase: (input: GitCheckoutInput) => Promise<void>;
  commitAll: (input: GitCommitInput) => Promise<void>;
  createBranch: (input: GitBranchInput) => Promise<void>;
  pushBranch: (input: GitBranchInput) => Promise<void>;
};

export type GitHubActionPullRequestClient = {
  createPullRequest: (input: PullRequestInput) => Promise<GitHubPullRequest>;
  findOpenPullRequest: (input: { baseBranch: string; branchName: string }) => Promise<GitHubPullRequest | undefined>;
  updatePullRequest: (input: PullRequestInput & { pullRequest: GitHubPullRequest }) => Promise<GitHubPullRequest>;
};

export type GitHubActionReporter = {
  appendSummary: (markdown: string) => Promise<void> | void;
  error: (message: string) => void;
  info: (message: string) => void;
  setOutput: (name: string, value: string) => Promise<void> | void;
  warn: (message: string) => void;
};

export type GitHubActionDeps = {
  git: GitHubActionGitClient;
  pullRequest: GitHubActionPullRequestClient;
  reporter: GitHubActionReporter;
  runDocstubeUpdate: (input: DocstubeActionCommandInput) => Promise<DocstubeActionCommandResult>;
  runDocstubeValidate: (input: DocstubeActionCommandInput) => Promise<DocstubeActionCommandResult>;
};

export type GitHubActionResult = {
  branchName: string;
  changed: boolean;
  changedFiles: readonly string[];
  changedPages: readonly GitHubActionChangedPage[];
  concurrencyGroup: string;
  exitCode: number;
  pullRequestUrl?: string;
  summary: string;
};

type ProcessRunResult = {
  exitCode: number;
  stderr: string;
  stdout: string;
};

export const actionPackageName = '@docstube/action';

const execFileAsync = promisify(execFile);
const defaultBranchPrefix = 'docstube/update';
const defaultCommitMessage = 'docs: update docstube output';
const defaultDocstubePackage = 'docstube@latest';

const compact = (value: string): string => value.trim().replace(/\s+/g, ' ');

const stripRefPrefix = (value: string): string => value.replace(/^refs\/heads\//, '');

const slugify = (value: string, fallback: string): string => {
  const slug = stripRefPrefix(value)
    .trim()
    .replace(/\\/g, '/')
    .replace(/[^A-Za-z0-9._/-]+/g, '-')
    .replace(/\/+/g, '/')
    .replace(/(^[-/]+)|([-/]+$)/g, '');

  return slug.length > 0 ? slug : fallback;
};

const redactSecrets = (value: string, secrets: readonly string[]): string => {
  let redacted = value;
  for (const secret of secrets) {
    if (secret.length >= 4) {
      redacted = redacted.replaceAll(secret, '[redacted]');
    }
  }
  return redacted;
};

const pageFromChangedFile = (path: string): GitHubActionChangedPage | undefined => {
  if (!path.endsWith('.mdx') && !path.endsWith('.md') && !path.endsWith('.astro')) {
    return undefined;
  }

  return { path, reasons: ['changed by docstube update'] };
};

const changedPagesFromFiles = (files: readonly string[]): readonly GitHubActionChangedPage[] =>
  files.flatMap((file) => pageFromChangedFile(file) ?? []);

const normalizeChangedPages = (
  commandPages: readonly GitHubActionChangedPage[] | undefined,
  changedFiles: readonly string[]
): readonly GitHubActionChangedPage[] =>
  commandPages && commandPages.length > 0 ? commandPages : changedPagesFromFiles(changedFiles);

const bulletList = (items: readonly string[]): string =>
  items.length === 0 ? '- None' : items.map((item) => `- ${item}`).join('\n');

const formatChangedPage = (page: GitHubActionChangedPage): string =>
  `- \`${page.path}\` - ${page.reasons.length > 0 ? page.reasons.join(', ') : 'changed by docstube update'}`;

const formatPullRequestBody = (input: {
  changedFiles: readonly string[];
  changedPages: readonly GitHubActionChangedPage[];
  concurrencyGroup: string;
}): string =>
  [
    '## docstube update',
    '',
    'This PR was created by the docstube GitHub Action. It contains generated documentation changes only.',
    '',
    '### Changed pages',
    input.changedPages.length === 0
      ? '- No page-level reasons were reported.'
      : input.changedPages.map(formatChangedPage).join('\n'),
    '',
    '### Changed files',
    bulletList(input.changedFiles.map((file) => `\`${file}\``)),
    '',
    '### Concurrency',
    `Recommended workflow concurrency group: \`${input.concurrencyGroup}\`.`
  ].join('\n');

const formatSummary = (input: {
  changedFiles: readonly string[];
  changedPages: readonly GitHubActionChangedPage[];
  dryRun: boolean;
  mode: GitHubActionMode;
  pullRequestUrl?: string;
  status: 'failed' | 'no-changes' | 'pull-request' | 'validated' | 'would-open-pr';
}): string => {
  const lines = [`## docstube ${input.mode}`, ''];

  if (input.status === 'validated') {
    lines.push('Validation completed without creating documentation changes.');
  } else if (input.status === 'failed') {
    lines.push('docstube did not complete successfully. No branch was pushed and no PR was opened.');
  } else if (input.status === 'no-changes') {
    lines.push('docstube completed and did not leave generated documentation changes.');
  } else if (input.status === 'would-open-pr') {
    lines.push('docstube completed in dry-run mode. A PR would have been opened for these changes.');
  } else {
    lines.push(`docstube opened or updated a PR: ${input.pullRequestUrl ?? 'unknown URL'}`);
  }

  if (input.dryRun) {
    lines.push('', 'Dry-run mode was enabled, so no branch was pushed.');
  }

  lines.push('', '### Changed pages');
  lines.push(input.changedPages.length === 0 ? '- None' : input.changedPages.map(formatChangedPage).join('\n'));
  lines.push('', '### Changed files');
  lines.push(bulletList(input.changedFiles.map((file) => `\`${file}\``)));

  return lines.join('\n');
};

const setActionOutputs = async (reporter: GitHubActionReporter, result: GitHubActionResult): Promise<void> => {
  await reporter.setOutput('changed', String(result.changed));
  await reporter.setOutput('branch-name', result.branchName);
  await reporter.setOutput('concurrency-group', result.concurrencyGroup);
  await reporter.setOutput('changed-files', JSON.stringify(result.changedFiles));
  await reporter.setOutput('changed-pages', JSON.stringify(result.changedPages));
  if (result.pullRequestUrl) {
    await reporter.setOutput('pull-request-url', result.pullRequestUrl);
  }
};

const completeAction = async (
  result: GitHubActionResult,
  reporter: GitHubActionReporter,
  secrets: readonly string[]
): Promise<GitHubActionResult> => {
  const summary = redactSecrets(result.summary, secrets);
  const sanitized = { ...result, summary };
  await reporter.appendSummary(summary);
  await setActionOutputs(reporter, sanitized);
  return sanitized;
};

export const createDocstubeActionBranchName = (input: { baseBranch?: string; branchPrefix?: string }): string => {
  const prefix = slugify(input.branchPrefix ?? defaultBranchPrefix, defaultBranchPrefix).replace(/\/+$/g, '');
  const base = slugify(input.baseBranch ?? 'main', 'main').replace(/\//g, '-');
  return `${prefix}/${base}`;
};

export const createDocstubeActionConcurrencyGroup = (input: { refName?: string; workflowName?: string }): string => {
  const workflow = slugify(input.workflowName ?? 'docstube', 'docstube').replace(/\//g, '-');
  const ref = slugify(input.refName ?? 'main', 'main').replace(/\//g, '-');
  return `docstube-${workflow}-${ref}`;
};

export const runGitHubAction = async (
  inputs: GitHubActionInputs,
  deps: GitHubActionDeps
): Promise<GitHubActionResult> => {
  const mode = inputs.mode ?? 'update';
  const baseBranch = inputs.baseBranch ?? 'main';
  const branchName = createDocstubeActionBranchName({
    baseBranch,
    branchPrefix: inputs.branchPrefix
  });
  const concurrencyGroup = createDocstubeActionConcurrencyGroup({
    refName: inputs.refName ?? baseBranch,
    workflowName: inputs.workflowName
  });
  const dryRun = inputs.dryRun === true;
  const secrets = [inputs.githubToken].filter(
    (secret): secret is string => typeof secret === 'string' && secret.length > 0
  );

  deps.reporter.info(`Starting docstube ${mode}.`);

  if (mode === 'validate') {
    const validateResult = await deps.runDocstubeValidate({
      configPath: inputs.configPath,
      workspaceDir: inputs.workspaceDir
    });
    const result: GitHubActionResult = {
      branchName,
      changed: false,
      changedFiles: [],
      changedPages: [],
      concurrencyGroup,
      exitCode: validateResult.exitCode,
      summary: formatSummary({
        changedFiles: [],
        changedPages: [],
        dryRun,
        mode,
        status: validateResult.exitCode === 0 ? 'validated' : 'failed'
      })
    };
    return completeAction(result, deps.reporter, secrets);
  }

  await deps.git.checkoutBase({ baseBranch, workspaceDir: inputs.workspaceDir });
  await deps.git.createBranch({ branchName, workspaceDir: inputs.workspaceDir });

  const updateResult = await deps.runDocstubeUpdate({
    configPath: inputs.configPath,
    workspaceDir: inputs.workspaceDir
  });

  if (updateResult.exitCode !== 0) {
    const output = updateResult.output ? `\n\n${compact(updateResult.output)}` : '';
    const result: GitHubActionResult = {
      branchName,
      changed: false,
      changedFiles: [],
      changedPages: [],
      concurrencyGroup,
      exitCode: updateResult.exitCode,
      summary:
        formatSummary({
          changedFiles: [],
          changedPages: [],
          dryRun,
          mode,
          status: 'failed'
        }) + output
    };
    return completeAction(result, deps.reporter, secrets);
  }

  const changedFiles = (await deps.git.changedFiles({ workspaceDir: inputs.workspaceDir })).toSorted();
  const changedPages = normalizeChangedPages(updateResult.changedPages, changedFiles);

  if (changedFiles.length === 0) {
    const result: GitHubActionResult = {
      branchName,
      changed: false,
      changedFiles,
      changedPages,
      concurrencyGroup,
      exitCode: 0,
      summary: formatSummary({
        changedFiles,
        changedPages,
        dryRun,
        mode,
        status: 'no-changes'
      })
    };
    return completeAction(result, deps.reporter, secrets);
  }

  const title = 'docs: update docstube output';
  const body = formatPullRequestBody({ changedFiles, changedPages, concurrencyGroup });

  if (dryRun) {
    const result: GitHubActionResult = {
      branchName,
      changed: true,
      changedFiles,
      changedPages,
      concurrencyGroup,
      exitCode: 0,
      summary: formatSummary({
        changedFiles,
        changedPages,
        dryRun,
        mode,
        status: 'would-open-pr'
      })
    };
    return completeAction(result, deps.reporter, secrets);
  }

  await deps.git.commitAll({
    message: inputs.commitMessage ?? defaultCommitMessage,
    workspaceDir: inputs.workspaceDir
  });
  await deps.git.pushBranch({ branchName, workspaceDir: inputs.workspaceDir });

  const existing = await deps.pullRequest.findOpenPullRequest({ baseBranch, branchName });
  const pullRequest = existing
    ? await deps.pullRequest.updatePullRequest({
        baseBranch,
        body,
        branchName,
        pullRequest: existing,
        title,
        workspaceDir: inputs.workspaceDir
      })
    : await deps.pullRequest.createPullRequest({
        baseBranch,
        body,
        branchName,
        title,
        workspaceDir: inputs.workspaceDir
      });

  const result: GitHubActionResult = {
    branchName,
    changed: true,
    changedFiles,
    changedPages,
    concurrencyGroup,
    exitCode: 0,
    pullRequestUrl: pullRequest.url,
    summary: formatSummary({
      changedFiles,
      changedPages,
      dryRun,
      mode,
      pullRequestUrl: pullRequest.url,
      status: 'pull-request'
    })
  };
  return completeAction(result, deps.reporter, secrets);
};

const runProcess = async (
  command: string,
  args: readonly string[],
  options: { cwd: string; env?: Record<string, string | undefined> }
): Promise<ProcessRunResult> => {
  try {
    const result = await execFileAsync(command, [...args], {
      cwd: options.cwd,
      encoding: 'utf8',
      env: { ...process.env, ...options.env },
      maxBuffer: 1024 * 1024 * 64
    });
    return {
      exitCode: 0,
      stderr: String(result.stderr ?? ''),
      stdout: String(result.stdout ?? '')
    };
  } catch (error) {
    const processError = error as { code?: unknown; message?: string; stderr?: unknown; stdout?: unknown };
    return {
      exitCode: typeof processError.code === 'number' ? processError.code : 1,
      stderr: String(processError.stderr ?? processError.message ?? ''),
      stdout: String(processError.stdout ?? '')
    };
  }
};

const parsePorcelainStatus = (stdout: string): readonly string[] =>
  stdout
    .split(/\r?\n/g)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 3)
    .map((line) => {
      const path = line.slice(3);
      const renamedPath = path.split(' -> ').at(-1);
      return renamedPath ?? path;
    });

const createGitClient = (): GitHubActionGitClient => ({
  checkoutBase: async (input) => {
    await runProcess('git', ['fetch', 'origin', input.baseBranch, '--depth=1'], { cwd: input.workspaceDir });
    const checkout = await runProcess('git', ['checkout', input.baseBranch], { cwd: input.workspaceDir });
    if (checkout.exitCode !== 0) {
      throw new Error(checkout.stderr || `Failed to checkout ${input.baseBranch}.`);
    }
    await runProcess('git', ['pull', '--ff-only', 'origin', input.baseBranch], { cwd: input.workspaceDir });
  },
  createBranch: async (input) => {
    const result = await runProcess('git', ['checkout', '-B', input.branchName], { cwd: input.workspaceDir });
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || `Failed to create ${input.branchName}.`);
    }
  },
  changedFiles: async (input) => {
    const result = await runProcess('git', ['status', '--porcelain'], { cwd: input.workspaceDir });
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || 'Failed to read git status.');
    }
    return parsePorcelainStatus(result.stdout);
  },
  commitAll: async (input) => {
    await runProcess('git', ['config', 'user.name', 'github-actions[bot]'], { cwd: input.workspaceDir });
    await runProcess('git', ['config', 'user.email', 'github-actions[bot]@users.noreply.github.com'], {
      cwd: input.workspaceDir
    });
    const add = await runProcess('git', ['add', '.'], { cwd: input.workspaceDir });
    if (add.exitCode !== 0) {
      throw new Error(add.stderr || 'Failed to stage docstube changes.');
    }
    const commit = await runProcess('git', ['commit', '-m', input.message], { cwd: input.workspaceDir });
    if (commit.exitCode !== 0) {
      throw new Error(commit.stderr || 'Failed to commit docstube changes.');
    }
  },
  pushBranch: async (input) => {
    const result = await runProcess(
      'git',
      ['push', '--force-with-lease', 'origin', `HEAD:refs/heads/${input.branchName}`],
      {
        cwd: input.workspaceDir
      }
    );
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || `Failed to push ${input.branchName}.`);
    }
  }
});

const parsePullRequest = (stdout: string): GitHubPullRequest | undefined => {
  const trimmed = stdout.trim();
  if (trimmed.length === 0 || trimmed === 'null') {
    return undefined;
  }

  const parsed = JSON.parse(trimmed) as { number?: unknown; url?: unknown };
  return typeof parsed.url === 'string'
    ? {
        number: typeof parsed.number === 'number' ? parsed.number : undefined,
        url: parsed.url
      }
    : undefined;
};

const createPullRequestClient = (token?: string): GitHubActionPullRequestClient => {
  const ghEnv = token ? { GH_TOKEN: token, GITHUB_TOKEN: token } : undefined;

  return {
    findOpenPullRequest: async (input) => {
      const result = await runProcess(
        'gh',
        [
          'pr',
          'list',
          '--base',
          input.baseBranch,
          '--head',
          input.branchName,
          '--state',
          'open',
          '--json',
          'number,url',
          '--jq',
          '.[0] // null'
        ],
        { cwd: process.cwd(), env: ghEnv }
      );
      if (result.exitCode !== 0) {
        throw new Error(result.stderr || 'Failed to query existing docstube PR.');
      }
      return parsePullRequest(result.stdout);
    },
    createPullRequest: async (input) => {
      const result = await runProcess(
        'gh',
        [
          'pr',
          'create',
          '--base',
          input.baseBranch,
          '--head',
          input.branchName,
          '--title',
          input.title,
          '--body',
          input.body
        ],
        { cwd: input.workspaceDir, env: ghEnv }
      );
      if (result.exitCode !== 0) {
        throw new Error(result.stderr || 'Failed to create docstube PR.');
      }
      return { url: result.stdout.trim() };
    },
    updatePullRequest: async (input) => {
      const selector = input.pullRequest.number ? String(input.pullRequest.number) : input.pullRequest.url;
      const result = await runProcess('gh', ['pr', 'edit', selector, '--title', input.title, '--body', input.body], {
        cwd: input.workspaceDir,
        env: ghEnv
      });
      if (result.exitCode !== 0) {
        throw new Error(result.stderr || 'Failed to update existing docstube PR.');
      }
      return input.pullRequest;
    }
  };
};

const createDocstubeCommandRunner =
  (mode: GitHubActionMode, docstubePackage: string) =>
  async (input: DocstubeActionCommandInput): Promise<DocstubeActionCommandResult> => {
    const args = ['--yes', docstubePackage, mode];
    const result = await runProcess('npx', args, { cwd: input.workspaceDir });
    return {
      exitCode: result.exitCode,
      output: [result.stdout, result.stderr].filter(Boolean).join('\n')
    };
  };

const createReporter = (env: NodeJS.ProcessEnv = process.env): GitHubActionReporter => ({
  appendSummary: async (markdown) => {
    if (env.GITHUB_STEP_SUMMARY) {
      await appendFile(env.GITHUB_STEP_SUMMARY, `${markdown}\n`, 'utf8');
      return;
    }
    console.info(markdown);
  },
  error: (message) => console.error(message),
  info: (message) => console.info(message),
  setOutput: async (name, value) => {
    if (!env.GITHUB_OUTPUT) {
      return;
    }
    const delimiter = `docstube_${name.replace(/[^A-Za-z0-9_]/g, '_')}`;
    await appendFile(env.GITHUB_OUTPUT, `${name}<<${delimiter}\n${value}\n${delimiter}\n`, 'utf8');
  },
  warn: (message) => console.warn(message)
});

export const createDefaultGitHubActionDeps = (input: {
  docstubePackage?: string;
  githubToken?: string;
}): GitHubActionDeps => {
  const docstubePackage = input.docstubePackage ?? defaultDocstubePackage;
  return {
    git: createGitClient(),
    pullRequest: createPullRequestClient(input.githubToken),
    reporter: createReporter(),
    runDocstubeUpdate: createDocstubeCommandRunner('update', docstubePackage),
    runDocstubeValidate: createDocstubeCommandRunner('validate', docstubePackage)
  };
};

const actionInputNames = (name: string): readonly string[] => [
  `INPUT_${name.toUpperCase().replace(/ /g, '_')}`,
  `INPUT_${name.toUpperCase().replace(/[- ]/g, '_')}`
];

const readActionInput = (env: NodeJS.ProcessEnv, name: string): string | undefined => {
  for (const inputName of actionInputNames(name)) {
    const value = env[inputName];
    if (value && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
};

const readBooleanActionInput = (env: NodeJS.ProcessEnv, name: string): boolean | undefined => {
  const value = readActionInput(env, name);
  if (!value) {
    return undefined;
  }
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

const readActionMode = (env: NodeJS.ProcessEnv): GitHubActionMode => {
  const raw = readActionInput(env, 'mode') ?? 'update';
  if (raw === 'update' || raw === 'validate') {
    return raw;
  }
  throw new Error(`Unsupported docstube Action mode: ${raw}.`);
};

export const readGitHubActionInputsFromEnv = (env: NodeJS.ProcessEnv = process.env): GitHubActionInputs => ({
  baseBranch: readActionInput(env, 'base-branch') ?? env.GITHUB_BASE_REF ?? env.GITHUB_REF_NAME ?? 'main',
  branchPrefix: readActionInput(env, 'branch-prefix'),
  commitMessage: readActionInput(env, 'commit-message'),
  configPath: readActionInput(env, 'config-path'),
  docstubePackage: readActionInput(env, 'docstube-package'),
  dryRun: readBooleanActionInput(env, 'dry-run'),
  githubToken: readActionInput(env, 'github-token') ?? env.GITHUB_TOKEN,
  mode: readActionMode(env),
  refName: env.GITHUB_REF_NAME,
  workspaceDir: readActionInput(env, 'workspace') ?? env.GITHUB_WORKSPACE ?? process.cwd(),
  workflowName: env.GITHUB_WORKFLOW
});

export const runGitHubActionFromEnv = async (env: NodeJS.ProcessEnv = process.env): Promise<GitHubActionResult> => {
  const inputs = readGitHubActionInputsFromEnv(env);
  const deps = createDefaultGitHubActionDeps({
    docstubePackage: inputs.docstubePackage,
    githubToken: inputs.githubToken
  });
  return runGitHubAction(inputs, deps);
};

const runDirectly = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;

if (runDirectly) {
  try {
    const result = await runGitHubActionFromEnv();
    process.exitCode = result.exitCode;
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'docstube GitHub Action failed.');
    process.exitCode = 1;
  }
}
