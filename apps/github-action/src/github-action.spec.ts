import { describe, expect, it } from 'vitest';
import type { Flag } from '@docstube/contracts';
import { digestIssueTitle, flagCommentMarker } from './delta-report.ts';
import type { IssueComment } from './delta-report.ts';
import {
  createDocstubeActionBranchName,
  createDocstubeActionConcurrencyGroup,
  createDocstubeCliRunner,
  readGitHubActionInputsFromEnv,
  runGitHubAction
} from './github-action.ts';
import type {
  DocstubeCliRunResult,
  GitHubActionDeps,
  GitHubActionGitClient,
  GitHubActionIssueClient,
  GitHubActionMergeControl,
  GitHubActionPullRequestClient,
  GitHubPullRequest
} from './github-action.ts';
import {
  buildFixtureFlag,
  buildFixtureShardWithFlags,
  buildFixtureWorkspace,
  shardRelativePath
} from './test-support.ts';

type HarnessOptions = {
  changedFiles?: readonly string[];
  cliResult?: DocstubeCliRunResult;
  enableAutoMergeError?: Error;
  existingComments?: readonly IssueComment[];
  existingDigestIssue?: { number: number };
  existingPullRequest?: GitHubPullRequest;
  shardFlags?: readonly Flag[];
  systemFlags?: readonly Flag[];
};

type Harness = {
  operations: string[];
  outputs: Record<string, string>;
  summaries: string[];
  deps: GitHubActionDeps;
  shardPath: string;
};

const createHarness = (options: HarnessOptions = {}): Harness => {
  const operations: string[] = [];
  const outputs: Record<string, string> = {};
  const summaries: string[] = [];

  const shard = buildFixtureShardWithFlags(options.shardFlags ?? []);
  const shardPath = shardRelativePath(shard);
  const workspace = buildFixtureWorkspace({ shards: [shard], systemFlags: options.systemFlags });
  const changedFiles = options.changedFiles ?? [
    'docs-site/content/en/getting-started/installation.mdx',
    '.docstube/manifest/manifest.yml',
    shardPath,
    '.docstube/cache/agent-calls/abc.json'
  ];

  const git: GitHubActionGitClient = {
    changedFiles: async () => {
      operations.push('changed-files');
      return changedFiles;
    },
    checkoutBase: async (input) => {
      operations.push(`checkout:${input.baseBranch}`);
    },
    commitPaths: async (input) => {
      operations.push(`commit:${input.message}:${input.paths.join(',')}`);
    },
    createBranch: async (input) => {
      operations.push(`branch:${input.branchName}`);
    },
    pushBranch: async (input) => {
      operations.push(`push:${input.branchName}`);
    }
  };

  const pullRequest: GitHubActionPullRequestClient = {
    createPullRequest: async (input) => {
      operations.push(`create-pr:${input.branchName}`);
      return { number: 12, url: 'https://github.com/stacktape/docstube/pull/12' };
    },
    findOpenPullRequest: async (input) => {
      operations.push(`find-pr:${input.branchName}`);
      return options.existingPullRequest;
    },
    updatePullRequest: async (input) => {
      operations.push(`update-pr:${input.pullRequest.number ?? input.pullRequest.url}`);
      return input.pullRequest;
    }
  };

  const issues: GitHubActionIssueClient = {
    listPullRequestComments: async ({ pullRequestNumber }) => {
      operations.push(`list-comments:${pullRequestNumber}`);
      return options.existingComments ?? [];
    },
    createPullRequestComment: async ({ pullRequestNumber, body }) => {
      operations.push(`create-comment:${pullRequestNumber}:${body.slice(0, flagCommentMarker.length)}`);
    },
    updateComment: async ({ commentId }) => {
      operations.push(`update-comment:${commentId}`);
    },
    findOpenIssueByTitle: async ({ title }) => {
      operations.push(`find-issue:${title}`);
      return options.existingDigestIssue;
    },
    createIssue: async ({ title }) => {
      operations.push(`create-issue:${title}`);
    },
    updateIssue: async ({ issueNumber }) => {
      operations.push(`update-issue:${issueNumber}`);
    }
  };

  const mergeControl: GitHubActionMergeControl = {
    enableAutoMerge: async ({ pullRequest: pr }) => {
      operations.push(`enable-auto-merge:${pr.number}`);
      if (options.enableAutoMergeError) {
        throw options.enableAutoMergeError;
      }
    }
  };

  return {
    operations,
    outputs,
    summaries,
    shardPath,
    deps: {
      git,
      issues,
      mergeControl,
      pullRequest,
      readWorkspaceFile: workspace.readWorkspaceFile,
      reporter: {
        appendSummary: (markdown) => {
          summaries.push(markdown);
        },
        error: (message) => {
          operations.push(`error:${message}`);
        },
        info: (message) => {
          operations.push(`info:${message}`);
        },
        setOutput: (name, value) => {
          outputs[name] = value;
        },
        warn: (message) => {
          operations.push(`warn:${message}`);
        }
      },
      runDocstube: async (input) => {
        operations.push(`cli:${input.mode}:${input.workspaceDir}`);
        return options.cliResult ?? { exitCode: 0 };
      }
    }
  };
};

describe('GitHub Action orchestration', () => {
  it('generate mode: commits atomically, opens a PR with the verified delta, enables auto-merge', async () => {
    const harness = createHarness();

    const result = await runGitHubAction(
      {
        baseBranch: 'main',
        githubToken: 'ghs_secret_token_123456',
        mode: 'generate',
        refName: 'main',
        workspaceDir: '/repo',
        workflowName: 'Docs'
      },
      harness.deps
    );

    expect(result).toMatchObject({
      autoMerge: 'enabled',
      branchName: 'docstube/docs/main',
      changed: true,
      concurrencyGroup: 'docstube-Docs-main',
      exitCode: 0,
      openFlagCount: 0,
      pullRequestNumber: 12,
      pullRequestUrl: 'https://github.com/stacktape/docstube/pull/12'
    });
    // One commit, machine-local cache excluded, docs + manifest + shard together.
    expect(harness.operations).toContain(
      `commit:docs: docstube generate:.docstube/manifest/manifest.yml,${harness.shardPath},docs-site/content/en/getting-started/installation.mdx`
    );
    expect(harness.operations).toContain('cli:generate:/repo');
    expect(harness.operations).toContain('enable-auto-merge:12');
    // No open flags → no flag comment.
    expect(harness.operations.some((op) => op.startsWith('create-comment') || op.startsWith('update-comment'))).toBe(
      false
    );
    // No tribal flags and no existing digest issue → issue untouched.
    expect(harness.operations.some((op) => op.startsWith('create-issue') || op.startsWith('update-issue'))).toBe(false);
    expect(harness.outputs['auto-merge']).toBe('enabled');
    expect(harness.summaries.join('\n')).toContain('Auto-merge enabled (squash).');
    expect(harness.summaries.join('\n')).toContain('2 | 1 | 0');
    expect(JSON.stringify({ operations: harness.operations, summaries: harness.summaries })).not.toContain(
      'ghs_secret_token_123456'
    );
  });

  it('blocking flag: no auto-merge, one marker-tagged flag comment, tribal digest issue created', async () => {
    const harness = createHarness({
      shardFlags: [
        buildFixtureFlag({ kind: 'tribal-knowledge', question: 'Why is retry hardcoded to 3?' }),
        buildFixtureFlag({ kind: 'coverage' })
      ]
    });

    const result = await runGitHubAction({ baseBranch: 'main', mode: 'refresh', workspaceDir: '/repo' }, harness.deps);

    expect(result.autoMerge).toBe('blocked');
    expect(result.openFlagCount).toBe(2);
    expect(harness.operations).not.toContain('enable-auto-merge:12');
    expect(harness.operations).toContain('list-comments:12');
    expect(harness.operations).toContain(`create-comment:12:${flagCommentMarker}`);
    expect(harness.operations).toContain(`find-issue:${digestIssueTitle}`);
    expect(harness.operations).toContain(`create-issue:${digestIssueTitle}`);
    expect(harness.summaries.join('\n')).toContain('Auto-merge blocked by 1 open flag(s)');
  });

  it('refreshes the existing marker-tagged comment and digest issue instead of spamming new ones', async () => {
    const harness = createHarness({
      existingComments: [
        { id: 5, body: 'human comment' },
        { id: 9, body: `${flagCommentMarker}\nold report` }
      ],
      existingDigestIssue: { number: 44 },
      existingPullRequest: { number: 7, url: 'https://github.com/stacktape/docstube/pull/7' },
      shardFlags: [buildFixtureFlag({ kind: 'tribal-knowledge' })]
    });

    const result = await runGitHubAction({ baseBranch: 'main', workspaceDir: '/repo' }, harness.deps);

    expect(result.pullRequestUrl).toBe('https://github.com/stacktape/docstube/pull/7');
    expect(harness.operations).toContain('update-pr:7');
    expect(harness.operations).toContain('update-comment:9');
    expect(harness.operations).toContain('update-issue:44');
    expect(harness.operations.some((op) => op.startsWith('create-comment'))).toBe(false);
    expect(harness.operations.some((op) => op.startsWith('create-issue'))).toBe(false);
  });

  it('a non-blocking coverage flag still gets the PR comment but auto-merge proceeds', async () => {
    const harness = createHarness({ shardFlags: [buildFixtureFlag({ kind: 'coverage' })] });

    const result = await runGitHubAction({ baseBranch: 'main', workspaceDir: '/repo' }, harness.deps);

    expect(result.autoMerge).toBe('enabled');
    expect(result.openFlagCount).toBe(1);
    expect(harness.operations).toContain(`create-comment:12:${flagCommentMarker}`);
    expect(harness.operations).toContain('enable-auto-merge:12');
  });

  it('system flags from the manifest index block auto-merge too', async () => {
    const harness = createHarness({ systemFlags: [buildFixtureFlag({ kind: 'system' })] });

    const result = await runGitHubAction({ baseBranch: 'main', workspaceDir: '/repo' }, harness.deps);

    expect(result.autoMerge).toBe('blocked');
    expect(harness.operations).not.toContain('enable-auto-merge:12');
  });

  it('falls back gracefully when the repository does not allow auto-merge', async () => {
    const harness = createHarness({ enableAutoMergeError: new Error('Pull request Auto merge is not allowed') });

    const result = await runGitHubAction({ baseBranch: 'main', workspaceDir: '/repo' }, harness.deps);

    expect(result.autoMerge).toBe('unavailable');
    expect(result.exitCode).toBe(0);
    expect(harness.operations.some((op) => op.startsWith('warn:Could not enable auto-merge'))).toBe(true);
    expect(harness.summaries.join('\n')).toContain('Auto-merge could not be enabled');
  });

  it('does nothing beyond the summary when the run leaves no committable changes', async () => {
    const harness = createHarness({ changedFiles: ['.docstube/cache/agent-calls/abc.json'] });

    const result = await runGitHubAction({ baseBranch: 'main', workspaceDir: '/repo' }, harness.deps);

    expect(result.changed).toBe(false);
    expect(result.autoMerge).toBe('skipped');
    expect(harness.operations.some((op) => op.startsWith('commit:') || op.startsWith('push:'))).toBe(false);
    expect(harness.summaries.join('\n')).toContain('left no documentation changes');
  });

  it('does not push or open a PR when the docstube CLI fails, and redacts secrets', async () => {
    const harness = createHarness({
      cliResult: { exitCode: 1, output: 'failed with token ghs_secret_token_123456' }
    });

    const result = await runGitHubAction(
      { baseBranch: 'main', githubToken: 'ghs_secret_token_123456', workspaceDir: '/repo' },
      harness.deps
    );

    expect(result.exitCode).toBe(1);
    expect(result.changed).toBe(false);
    expect(harness.operations.some((op) => op.startsWith('push:') || op.startsWith('create-pr:'))).toBe(false);
    expect(harness.summaries.join('\n')).toContain('[redacted]');
    expect(harness.summaries.join('\n')).not.toContain('ghs_secret_token_123456');
  });
});

describe('inputs and CLI invocation', () => {
  it('runs the docstube CLI as a subprocess via npx in the workspace', async () => {
    const calls: { args: readonly string[]; command: string; cwd: string }[] = [];
    const runner = createDocstubeCliRunner('docstube@1.0.0', async (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd });
      return { exitCode: 0, stdout: 'ok', stderr: '' };
    });

    await expect(runner({ mode: 'refresh', workspaceDir: '/repo' })).resolves.toEqual({ exitCode: 0, output: 'ok' });
    expect(calls).toEqual([{ command: 'npx', args: ['--yes', 'docstube@1.0.0', 'refresh'], cwd: '/repo' }]);
  });

  it('creates deterministic branch names and concurrency groups', () => {
    expect(createDocstubeActionBranchName({ baseBranch: 'feature/docs!', branchPrefix: 'docstube updates' })).toBe(
      'docstube-updates/feature-docs'
    );
    expect(createDocstubeActionConcurrencyGroup({ refName: 'refs/heads/main', workflowName: 'Docs Update' })).toBe(
      'docstube-Docs-Update-main'
    );
  });

  it('reads generate and refresh modes from the environment', () => {
    const inputs = readGitHubActionInputsFromEnv({
      GITHUB_REPOSITORY: 'stacktape/docstube',
      GITHUB_WORKSPACE: '/repo',
      INPUT_MODE: 'generate',
      'INPUT_GITHUB-TOKEN': 'ghs_secret_token_123456'
    });

    expect(inputs).toMatchObject({
      githubToken: 'ghs_secret_token_123456',
      mode: 'generate',
      repository: 'stacktape/docstube',
      workspaceDir: '/repo'
    });
  });

  it('rejects removed and unknown modes', () => {
    expect(() => readGitHubActionInputsFromEnv({ GITHUB_WORKSPACE: '/repo', INPUT_MODE: 'validate' })).toThrow(
      'Unsupported docstube Action mode: validate.'
    );
    expect(() => readGitHubActionInputsFromEnv({ GITHUB_WORKSPACE: '/repo', INPUT_MODE: 'update' })).toThrow(
      'Unsupported docstube Action mode: update.'
    );
  });

  it('rejects the removed dry-run input instead of silently ignoring it', () => {
    expect(() =>
      readGitHubActionInputsFromEnv({ GITHUB_WORKSPACE: '/repo', INPUT_MODE: 'refresh', 'INPUT_DRY-RUN': 'true' })
    ).toThrow('dry-run input was removed');
  });
});
