import { describe, expect, it } from 'vitest';
import {
  createDocstubeCommandRunner,
  createDocstubeActionBranchName,
  createDocstubeActionConcurrencyGroup,
  parseChangedPagesFromDocstubeOutput,
  readGitHubActionInputsFromEnv,
  runGitHubAction
} from './github-action.ts';
import type {
  DocstubeActionCommandInput,
  DocstubeActionCommandResult,
  GitHubActionChangedPage,
  GitHubActionDeps,
  GitHubActionGitClient,
  GitHubActionPullRequestClient,
  GitHubPullRequest
} from './github-action.ts';

type HarnessOptions = {
  changedFiles?: readonly string[];
  existingPullRequest?: GitHubPullRequest;
  refreshResult?: DocstubeActionCommandResult;
  validateResult?: DocstubeActionCommandResult;
};

type Harness = {
  operations: string[];
  outputs: Record<string, string>;
  summaries: string[];
  deps: GitHubActionDeps;
};

const changedPage = (path: string, reasons: readonly string[]): GitHubActionChangedPage => ({ path, reasons });

const createHarness = (options: HarnessOptions = {}): Harness => {
  const operations: string[] = [];
  const outputs: Record<string, string> = {};
  const summaries: string[] = [];
  const changedFiles = options.changedFiles ?? [];
  const refreshResult = options.refreshResult ?? {
    changedPages: [changedPage('docs/overview.mdx', ['changed-provenance-input'])],
    exitCode: 0
  };
  const validateResult = options.validateResult ?? { exitCode: 0 };

  const git: GitHubActionGitClient = {
    changedFiles: async () => {
      operations.push('changed-files');
      return changedFiles;
    },
    checkoutBase: async (input) => {
      operations.push(`checkout:${input.baseBranch}`);
    },
    commitAll: async (input) => {
      operations.push(`commit:${input.message}`);
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

  const runDocstubeRefresh = async (input: DocstubeActionCommandInput) => {
    operations.push(`refresh:${input.workspaceDir}`);
    return refreshResult;
  };

  const runDocstubeValidate = async (input: DocstubeActionCommandInput) => {
    operations.push(`validate:${input.workspaceDir}`);
    return validateResult;
  };

  return {
    operations,
    outputs,
    summaries,
    deps: {
      git,
      pullRequest,
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
      runDocstubeRefresh,
      runDocstubeValidate
    }
  };
};

describe('GitHub Action wrapper', () => {
  it('opens a PR for docstube refresh changes and reports page reasons', async () => {
    const harness = createHarness({
      changedFiles: ['docs/overview.mdx', '.docstube/manifest.yml']
    });

    const result = await runGitHubAction(
      {
        baseBranch: 'main',
        githubToken: 'ghs_secret_token_123456',
        refName: 'main',
        workspaceDir: '/repo',
        workflowName: 'Docs Update'
      },
      harness.deps
    );

    expect(result).toMatchObject({
      branchName: 'docstube/refresh/main',
      changed: true,
      concurrencyGroup: 'docstube-Docs-Update-main',
      exitCode: 0,
      pullRequestUrl: 'https://github.com/stacktape/docstube/pull/12'
    });
    expect(harness.operations).toEqual([
      'info:Starting docstube refresh.',
      'checkout:main',
      'branch:docstube/refresh/main',
      'refresh:/repo',
      'changed-files',
      'commit:docs: refresh docstube output',
      'push:docstube/refresh/main',
      'find-pr:docstube/refresh/main',
      'create-pr:docstube/refresh/main'
    ]);
    expect(harness.summaries.join('\n')).toContain('changed-provenance-input');
    expect(harness.summaries.join('\n')).toContain('docs/overview.mdx');
    expect(harness.outputs.changed).toBe('true');
    expect(harness.outputs['pull-request-url']).toBe('https://github.com/stacktape/docstube/pull/12');
    expect(
      JSON.stringify({ operations: harness.operations, outputs: harness.outputs, summaries: harness.summaries })
    ).not.toContain('ghs_secret_token_123456');
  });

  it('reuses an open PR on idempotent reruns', async () => {
    const harness = createHarness({
      changedFiles: ['docs/overview.mdx'],
      existingPullRequest: { number: 7, url: 'https://github.com/stacktape/docstube/pull/7' }
    });

    const result = await runGitHubAction({ baseBranch: 'main', workspaceDir: '/repo' }, harness.deps);

    expect(result.pullRequestUrl).toBe('https://github.com/stacktape/docstube/pull/7');
    expect(harness.operations).toContain('find-pr:docstube/refresh/main');
    expect(harness.operations).toContain('update-pr:7');
    expect(harness.operations).not.toContain('create-pr:docstube/refresh/main');
  });

  it('never pushes generated docs silently when there are no changes', async () => {
    const harness = createHarness({ changedFiles: [], refreshResult: { exitCode: 0 } });

    const result = await runGitHubAction({ baseBranch: 'main', workspaceDir: '/repo' }, harness.deps);

    expect(result.changed).toBe(false);
    expect(harness.operations).toEqual([
      'info:Starting docstube refresh.',
      'checkout:main',
      'branch:docstube/refresh/main',
      'refresh:/repo',
      'changed-files'
    ]);
    expect(harness.summaries.join('\n')).toContain('did not leave generated documentation changes');
    expect(harness.outputs.changed).toBe('false');
  });

  it('reports dry-run PR output without committing or pushing', async () => {
    const harness = createHarness({ changedFiles: ['docs/overview.mdx'] });

    const result = await runGitHubAction({ baseBranch: 'main', dryRun: true, workspaceDir: '/repo' }, harness.deps);

    expect(result.changed).toBe(true);
    expect(result.pullRequestUrl).toBeUndefined();
    expect(harness.operations).not.toContain('commit:docs: refresh docstube output');
    expect(harness.operations).not.toContain('push:docstube/refresh/main');
    expect(harness.operations).not.toContain('create-pr:docstube/refresh/main');
    expect(harness.summaries.join('\n')).toContain('dry-run mode');
  });

  it('does not push or open a PR when docstube refresh fails', async () => {
    const harness = createHarness({
      refreshResult: { exitCode: 1, output: 'failed with token ghs_secret_token_123456' }
    });

    const result = await runGitHubAction(
      { baseBranch: 'main', githubToken: 'ghs_secret_token_123456', workspaceDir: '/repo' },
      harness.deps
    );

    expect(result.exitCode).toBe(1);
    expect(result.changed).toBe(false);
    expect(harness.operations).toEqual([
      'info:Starting docstube refresh.',
      'checkout:main',
      'branch:docstube/refresh/main',
      'refresh:/repo'
    ]);
    expect(harness.summaries.join('\n')).toContain('[redacted]');
    expect(harness.summaries.join('\n')).not.toContain('ghs_secret_token_123456');
  });

  it('runs validate mode without creating a refresh branch', async () => {
    const harness = createHarness();

    const result = await runGitHubAction({ mode: 'validate', workspaceDir: '/repo' }, harness.deps);

    expect(result.exitCode).toBe(0);
    expect(result.changed).toBe(false);
    expect(harness.operations).toEqual(['info:Starting docstube validate.', 'validate:/repo']);
    expect(harness.outputs.changed).toBe('false');
  });

  it('passes config-path through the default npx command runner', async () => {
    const calls: { args: readonly string[]; command: string; cwd: string }[] = [];
    const runner = createDocstubeCommandRunner('refresh', 'docstube@latest', async (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd });
      return { exitCode: 0, stdout: 'ok', stderr: '' };
    });

    await expect(
      runner({
        configPath: 'config/docstube.yml',
        workspaceDir: '/repo'
      })
    ).resolves.toEqual({ changedPages: [], exitCode: 0, output: 'ok' });
    expect(calls).toEqual([
      {
        command: 'npx',
        args: ['--yes', 'docstube@latest', 'refresh', '--config', 'config/docstube.yml'],
        cwd: '/repo'
      }
    ]);
  });

  it('parses changed page reasons from docstube refresh output', () => {
    expect(
      parseChangedPagesFromDocstubeOutput(
        ['Loaded manifest with 2 pages.', 'regenerated: overview (changed-provenance-input, topology-pass)'].join('\n')
      )
    ).toEqual([{ path: 'overview', reasons: ['changed-provenance-input', 'topology-pass'] }]);
  });

  it('creates deterministic branch names and concurrency groups', () => {
    expect(createDocstubeActionBranchName({ baseBranch: 'feature/docs!', branchPrefix: 'docstube updates' })).toBe(
      'docstube-updates/feature-docs'
    );
    expect(createDocstubeActionConcurrencyGroup({ refName: 'refs/heads/main', workflowName: 'Docs Update' })).toBe(
      'docstube-Docs-Update-main'
    );
  });

  it('reads GitHub action inputs with hyphen-preserving env names', () => {
    const inputs = readGitHubActionInputsFromEnv({
      GITHUB_REF_NAME: 'main',
      GITHUB_WORKFLOW: 'Docs Update',
      GITHUB_WORKSPACE: '/repo',
      INPUT_BASE_BRANCH: 'fallback',
      'INPUT_BASE-BRANCH': 'release/v1',
      'INPUT_DRY-RUN': 'true',
      'INPUT_GITHUB-TOKEN': 'ghs_secret_token_123456',
      INPUT_MODE: 'refresh'
    });

    expect(inputs).toMatchObject({
      baseBranch: 'release/v1',
      dryRun: true,
      githubToken: 'ghs_secret_token_123456',
      refName: 'main',
      workspaceDir: '/repo',
      workflowName: 'Docs Update'
    });
  });

  it('rejects the removed update mode alias', () => {
    expect(() =>
      readGitHubActionInputsFromEnv({
        GITHUB_WORKSPACE: '/repo',
        INPUT_MODE: 'update'
      })
    ).toThrow('Unsupported docstube Action mode: update.');
  });
});
