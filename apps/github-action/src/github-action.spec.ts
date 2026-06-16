import { describe, expect, it } from 'vitest';
import {
  createDocstubeActionBranchName,
  createDocstubeActionConcurrencyGroup,
  readGitHubActionInputsFromEnv,
  runGitHubAction
} from './github-action';
import type {
  DocstubeActionCommandInput,
  DocstubeActionCommandResult,
  GitHubActionChangedPage,
  GitHubActionDeps,
  GitHubActionGitClient,
  GitHubActionPullRequestClient,
  GitHubPullRequest
} from './github-action';

type HarnessOptions = {
  changedFiles?: readonly string[];
  existingPullRequest?: GitHubPullRequest;
  updateResult?: DocstubeActionCommandResult;
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
  const updateResult = options.updateResult ?? {
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

  const runDocstubeUpdate = async (input: DocstubeActionCommandInput) => {
    operations.push(`update:${input.workspaceDir}`);
    return updateResult;
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
      runDocstubeUpdate,
      runDocstubeValidate
    }
  };
};

describe('GitHub Action wrapper', () => {
  it('opens a PR for docstube update changes and reports page reasons', async () => {
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
      branchName: 'docstube/update/main',
      changed: true,
      concurrencyGroup: 'docstube-Docs-Update-main',
      exitCode: 0,
      pullRequestUrl: 'https://github.com/stacktape/docstube/pull/12'
    });
    expect(harness.operations).toEqual([
      'info:Starting docstube update.',
      'checkout:main',
      'branch:docstube/update/main',
      'update:/repo',
      'changed-files',
      'commit:docs: update docstube output',
      'push:docstube/update/main',
      'find-pr:docstube/update/main',
      'create-pr:docstube/update/main'
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
    expect(harness.operations).toContain('find-pr:docstube/update/main');
    expect(harness.operations).toContain('update-pr:7');
    expect(harness.operations).not.toContain('create-pr:docstube/update/main');
  });

  it('never pushes generated docs silently when there are no changes', async () => {
    const harness = createHarness({ changedFiles: [], updateResult: { exitCode: 0 } });

    const result = await runGitHubAction({ baseBranch: 'main', workspaceDir: '/repo' }, harness.deps);

    expect(result.changed).toBe(false);
    expect(harness.operations).toEqual([
      'info:Starting docstube update.',
      'checkout:main',
      'branch:docstube/update/main',
      'update:/repo',
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
    expect(harness.operations).not.toContain('commit:docs: update docstube output');
    expect(harness.operations).not.toContain('push:docstube/update/main');
    expect(harness.operations).not.toContain('create-pr:docstube/update/main');
    expect(harness.summaries.join('\n')).toContain('dry-run mode');
  });

  it('does not push or open a PR when docstube update fails', async () => {
    const harness = createHarness({
      updateResult: { exitCode: 1, output: 'failed with token ghs_secret_token_123456' }
    });

    const result = await runGitHubAction(
      { baseBranch: 'main', githubToken: 'ghs_secret_token_123456', workspaceDir: '/repo' },
      harness.deps
    );

    expect(result.exitCode).toBe(1);
    expect(result.changed).toBe(false);
    expect(harness.operations).toEqual([
      'info:Starting docstube update.',
      'checkout:main',
      'branch:docstube/update/main',
      'update:/repo'
    ]);
    expect(harness.summaries.join('\n')).toContain('[redacted]');
    expect(harness.summaries.join('\n')).not.toContain('ghs_secret_token_123456');
  });

  it('runs validate mode without creating an update branch', async () => {
    const harness = createHarness();

    const result = await runGitHubAction({ mode: 'validate', workspaceDir: '/repo' }, harness.deps);

    expect(result.exitCode).toBe(0);
    expect(result.changed).toBe(false);
    expect(harness.operations).toEqual(['info:Starting docstube validate.', 'validate:/repo']);
    expect(harness.outputs.changed).toBe('false');
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
      INPUT_MODE: 'update'
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
});
