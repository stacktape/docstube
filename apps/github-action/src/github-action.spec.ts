import { describe, expect, it } from 'vitest';
import type { Flag } from '@docstube/contracts';
import { sha256Hex } from '@docstube/contracts';
import { digestIssueTitle, flagCommentMarker } from './delta-report.ts';
import type { IssueComment } from './delta-report.ts';
import {
  createDocstubeActionBranchName,
  createDocstubeActionConcurrencyGroup,
  createDocstubeCliRunner,
  createGitClient,
  readGitHubActionInputsFromEnv,
  runGitHubAction
} from './github-action.ts';
import type {
  DocstubeCliRunResult,
  GitHubActionDeps,
  GitHubActionGitClient,
  GitHubActionIssueClient,
  GitHubActionMergeControl,
  GitHubActionProcessRunner,
  GitHubPullRequest,
  GitHubActionPullRequestClient
} from './github-action.ts';
import type { PreflightRunResult } from './ci-preflight-gate.ts';
import {
  attachFixturePublication,
  buildFixtureFlag,
  buildFixturePreflightReport,
  buildFixtureShardWithFlags,
  buildFixtureWorkspace,
  fixtureHeadCommit,
  shardRelativePath
} from './test-support.ts';

type HarnessOptions = {
  changedFiles?: readonly string[];
  cliResult?: DocstubeCliRunResult;
  declaredPaths?: readonly string[];
  decision?: Record<string, unknown>;
  decisionText?: string;
  enableAutoMergeError?: Error;
  env?: NodeJS.ProcessEnv;
  existingComments?: readonly IssueComment[];
  existingDigestIssue?: { number: number };
  existingPullRequest?: GitHubPullRequest;
  headCommit?: string | undefined;
  latestVersion?: string;
  omitDecision?: boolean;
  // Omitted by default so the legacy credential fallback stays exercised; tests that care about
  // the preflight supply exactly the stdout the pinned CLI would have printed.
  preflight?: PreflightRunResult;
  shardFlags?: readonly Flag[];
  systemFlags?: readonly Flag[];
  workspaceFiles?: Record<string, string>;
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
  for (const [path, content] of Object.entries(options.workspaceFiles ?? {})) {
    workspace.files.set(path, content);
  }
  const changedFiles = options.changedFiles ?? [
    'docs-site/content/en/getting-started/installation.mdx',
    '.docstube/manifest/manifest.json',
    shardPath,
    '.docstube/cache/agent-calls/abc.json'
  ];
  // The declared output inventory: by default exactly the committable paths this run touched.
  attachFixturePublication({
    files: workspace.files,
    declaredPaths: options.declaredPaths ?? [
      'docs-site/content/en/getting-started/installation.mdx',
      '.docstube/manifest/manifest.json',
      shardPath
    ],
    decision: options.decision,
    decisionText: options.decisionText,
    omitDecision: options.omitDecision
  });

  const git: GitHubActionGitClient = {
    changedFiles: async () => {
      operations.push('changed-files');
      return changedFiles;
    },
    headCommit: async () => ('headCommit' in options ? options.headCommit : fixtureHeadCommit),
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
      hashWorkspaceFile: async (relativePath) => {
        const content = workspace.files.get(relativePath);
        return content === undefined ? undefined : sha256Hex(content);
      },
      env: options.env ?? { ANTHROPIC_API_KEY: 'test-anthropic-key-123456' },
      checkLatestDocstubeVersion: async () => options.latestVersion,
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
        notice: (message) => {
          operations.push(`notice:${message}`);
        },
        setOutput: (name, value) => {
          outputs[name] = value;
        },
        warn: (message) => {
          operations.push(`warn:${message}`);
        }
      },
      runDocstube: async (input) => {
        operations.push(`cli:generate:${input.workspaceDir}`);
        return options.cliResult ?? { exitCode: 0 };
      },
      ...(options.preflight === undefined
        ? {}
        : {
            runPreflight: async (input: { workspaceDir: string }) => {
              operations.push(`cli:preflight:${input.workspaceDir}`);
              return options.preflight as PreflightRunResult;
            }
          })
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
      `commit:docs: docstube generate:.docstube/manifest/manifest.json,${harness.shardPath},docs-site/content/en/getting-started/installation.mdx`
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
    expect(harness.summaries.join('\n')).toContain('1 | 1 | 0');
    // The decision is reported plainly, not implied by the absence of complaints.
    expect(harness.summaries.join('\n')).toContain('Execution: **completed**');
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

    const result = await runGitHubAction({ baseBranch: 'main', workspaceDir: '/repo' }, harness.deps);

    expect(result.autoMerge).toBe('blocked');
    expect(result.openFlagCount).toBe(2);
    expect(harness.operations).not.toContain('enable-auto-merge:12');
    expect(harness.operations).toContain('list-comments:12');
    expect(harness.operations).toContain(`create-comment:12:${flagCommentMarker}`);
    expect(harness.operations).toContain(`find-issue:${digestIssueTitle}`);
    expect(harness.operations).toContain(`create-issue:${digestIssueTitle}`);
    expect(harness.summaries.join('\n')).toContain('1 open blocking flag (coverage).');
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

  it('a non-blocking tribal-knowledge flag still gets the PR comment but auto-merge proceeds', async () => {
    const harness = createHarness({ shardFlags: [buildFixtureFlag({ kind: 'tribal-knowledge' })] });

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

  it('aborts BEFORE generation when a blocking preflight check fails, spending nothing on models', async () => {
    const report = buildFixturePreflightReport({
      checks: [
        {
          id: 'transport-credential',
          title: 'transport credential',
          status: 'fail',
          blocking: true,
          detail: 'agents.transport is anthropic-api and ANTHROPIC_API_KEY is not set in this environment',
          remedy: 'Pass ANTHROPIC_API_KEY to the docstube step via `env:` from a repository secret.'
        }
      ],
      automationMode: 'manual',
      automationReason: 'the repository does not allow auto-merge.'
    });
    const harness = createHarness({
      preflight: { exitCode: 1, stdout: JSON.stringify(report), stderr: '' }
    });

    const result = await runGitHubAction({ baseBranch: 'main', workspaceDir: '/repo' }, harness.deps);

    expect(result.exitCode).toBe(1);
    expect(result.preflight).toBe('blocked');
    expect(result.changed).toBe(false);
    // The preflight ran; the generate step and every git mutation did not.
    expect(harness.operations).toContain('cli:preflight:/repo');
    expect(harness.operations.some((op) => op.startsWith('cli:generate:'))).toBe(false);
    expect(harness.operations.some((op) => op.startsWith('checkout:') || op.startsWith('branch:'))).toBe(false);
    const summary = harness.summaries.join('\n');
    expect(summary).toContain('spent nothing on models');
    expect(summary).toContain('ANTHROPIC_API_KEY');
    expect(harness.outputs.preflight).toBe('blocked');
  });

  it('runs generation when the preflight passes and reports the honest automation mode', async () => {
    const report = buildFixturePreflightReport({
      automationMode: 'approval-assisted',
      automationReason: "PRs opened with the workflow's GITHUB_TOKEN do not trigger workflow runs."
    });
    const harness = createHarness({ preflight: { exitCode: 0, stdout: JSON.stringify(report), stderr: '' } });

    const result = await runGitHubAction({ baseBranch: 'main', workspaceDir: '/repo' }, harness.deps);

    expect(result.exitCode).toBe(0);
    expect(result.preflight).toBe('passed');
    expect(result.automationMode).toBe('approval-assisted');
    expect(harness.operations).toContain('cli:preflight:/repo');
    expect(harness.operations).toContain('cli:generate:/repo');
    expect(harness.outputs['automation-mode']).toBe('approval-assisted');
    // The honest label is surfaced on the run page, not buried in the JSON.
    expect(harness.operations.some((op) => op.startsWith('notice:') && op.includes('approval-assisted'))).toBe(true);
  });

  it('degrades to the legacy credential check — loudly — when the pinned CLI has no preflight', async () => {
    const harness = createHarness({ preflight: { exitCode: 1, stdout: 'Unknown command: doctor', stderr: '' } });

    const result = await runGitHubAction({ baseBranch: 'main', workspaceDir: '/repo' }, harness.deps);

    expect(result.exitCode).toBe(0);
    expect(result.preflight).toBe('unavailable');
    expect(harness.operations.some((op) => op.startsWith('warn:CI preflight unavailable'))).toBe(true);
    expect(harness.operations).toContain('cli:generate:/repo');
  });

  it('fails fast with a clear message when no model credential is present', async () => {
    const harness = createHarness({ env: { PATH: '/usr/bin' } });

    const result = await runGitHubAction({ baseBranch: 'main', workspaceDir: '/repo' }, harness.deps);

    expect(result.exitCode).toBe(1);
    expect(result.changed).toBe(false);
    // Fails before any git mutation or CLI run.
    expect(harness.operations.some((op) => op.startsWith('checkout:') || op.startsWith('cli:'))).toBe(false);
    expect(harness.summaries.join('\n')).toContain('No model credential found');
    expect(harness.summaries.join('\n')).toContain('ANTHROPIC_API_KEY');
  });

  it('honors the apiKeyEnv names from docstube.yml for the credential precondition', async () => {
    const config = 'agents:\n  writer:\n    apiKeyEnv: MY_CUSTOM_MODEL_CREDENTIAL\n';
    const withCustom = createHarness({
      env: { MY_CUSTOM_MODEL_CREDENTIAL: 'present-value-1234' },
      workspaceFiles: { 'docstube.yml': config }
    });
    const ok = await runGitHubAction({ baseBranch: 'main', workspaceDir: '/repo' }, withCustom.deps);
    expect(ok.exitCode).toBe(0);
    expect(withCustom.operations).toContain('cli:generate:/repo');

    // The common names do not satisfy a config that names its own env var.
    const withWrong = createHarness({
      env: { ANTHROPIC_API_KEY: 'present-but-not-what-config-names' },
      workspaceFiles: { 'docstube.yml': config }
    });
    const failed = await runGitHubAction({ baseBranch: 'main', workspaceDir: '/repo' }, withWrong.deps);
    expect(failed.exitCode).toBe(1);
    expect(withWrong.summaries.join('\n')).toContain('MY_CUSTOM_MODEL_CREDENTIAL');
  });

  it('scrubs values of KEY/TOKEN/SECRET-named env vars from logged output', async () => {
    const harness = createHarness({
      cliResult: { exitCode: 1, output: 'transport error: bearer sk-live-anthropic-abcdef used by NODE_ENV=ci' },
      env: { ANTHROPIC_API_KEY: 'sk-live-anthropic-abcdef', NODE_ENV: 'ci' }
    });

    const result = await runGitHubAction({ baseBranch: 'main', workspaceDir: '/repo' }, harness.deps);

    expect(result.exitCode).toBe(1);
    const summary = harness.summaries.join('\n');
    expect(summary).toContain('[redacted]');
    expect(summary).not.toContain('sk-live-anthropic-abcdef');
    // Non-credential env values are left alone.
    expect(summary).toContain('NODE_ENV=ci');
  });

  it('emits a notice when the pinned docstube version is behind the registry, and stays quiet otherwise', async () => {
    const behind = createHarness({ latestVersion: '9.9.9' });
    await runGitHubAction(
      { baseBranch: 'main', docstubePackage: 'docstube@1.0.0', workspaceDir: '/repo' },
      behind.deps
    );
    expect(behind.operations.some((op) => op.startsWith('notice:') && op.includes('9.9.9'))).toBe(true);

    const current = createHarness({ latestVersion: '1.0.0' });
    await runGitHubAction(
      { baseBranch: 'main', docstubePackage: 'docstube@1.0.0', workspaceDir: '/repo' },
      current.deps
    );
    expect(current.operations.some((op) => op.startsWith('notice:'))).toBe(false);

    // Unpinned specs (a tag like @latest) and registry failures are silently skipped.
    const unpinned = createHarness({ latestVersion: '9.9.9' });
    await runGitHubAction(
      { baseBranch: 'main', docstubePackage: 'docstube@latest', workspaceDir: '/repo' },
      unpinned.deps
    );
    expect(unpinned.operations.some((op) => op.startsWith('notice:'))).toBe(false);
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

// The hazard this gate exists to close (PRODUCT §3.3): a run that did not finish, or that cannot
// prove what it produced, must never merge unattended — regardless of how clean the flags look.
describe('publication decision enforcement', () => {
  it('no decision artifact: the PR opens but auto-merge is withheld and says so', async () => {
    const harness = createHarness({ omitDecision: true });

    const result = await runGitHubAction({ baseBranch: 'main', workspaceDir: '/repo' }, harness.deps);

    expect(result.autoMerge).toBe('blocked');
    expect(harness.operations).not.toContain('enable-auto-merge:12');
    expect(result.withheldReasons.join(' ')).toContain('no publication decision was found');
    expect(harness.summaries.join('\n')).toContain('No enforceable publication decision');
  });

  it('unparseable and schema-invalid decisions both fail closed', async () => {
    const brokenJson = createHarness({ decisionText: '{not json' });
    const broken = await runGitHubAction({ baseBranch: 'main', workspaceDir: '/repo' }, brokenJson.deps);
    expect(broken.autoMerge).toBe('blocked');
    expect(broken.withheldReasons.join(' ')).toContain('not readable JSON');

    // Arithmetic the contract enforces: planned must split into completed + deferred.
    const invalid = createHarness({ decision: { plan: { planned: 3, completed: 1, deferred: 0 } } });
    const result = await runGitHubAction({ baseBranch: 'main', workspaceDir: '/repo' }, invalid.deps);
    expect(result.autoMerge).toBe('blocked');
    expect(result.withheldReasons.join(' ')).toContain('does not satisfy the contract');
  });

  it('a decision bound to a different tree or a different commit never merges', async () => {
    const wrongTree = createHarness({ decision: { candidateArtifactHash: 'f'.repeat(64) } });
    const treeResult = await runGitHubAction({ baseBranch: 'main', workspaceDir: '/repo' }, wrongTree.deps);
    expect(treeResult.autoMerge).toBe('blocked');
    expect(treeResult.withheldReasons.join(' ')).toContain('describes a different tree');

    const wrongCommit = createHarness({ headCommit: 'b'.repeat(40) });
    const commitResult = await runGitHubAction({ baseBranch: 'main', workspaceDir: '/repo' }, wrongCommit.deps);
    expect(commitResult.autoMerge).toBe('blocked');
    expect(commitResult.withheldReasons.join(' ')).toContain('describes a different revision');
  });

  it('a reason code from a newer CLI fails closed with an explicit registry message', async () => {
    const harness = createHarness({
      decision: {
        deterministicGate: 'blocked',
        publishable: false,
        autoMergeEligible: false,
        reasonCodes: ['gate.blocked', 'policy.future-condition']
      }
    });

    const result = await runGitHubAction({ baseBranch: 'main', workspaceDir: '/repo' }, harness.deps);

    expect(result.autoMerge).toBe('blocked');
    expect(result.withheldReasons.join(' ')).toContain('cannot interpret');
    expect(result.withheldReasons.join(' ')).toContain('policy.future-condition');
  });

  it('a budget-paused run never merges, and the PR says what was deferred', async () => {
    const harness = createHarness({
      decision: {
        execution: 'paused-budget',
        plan: { planned: 4, completed: 1, deferred: 3 },
        publishable: false,
        autoMergeEligible: false,
        reasonCodes: ['budget.frozen', 'plan.deferred']
      }
    });

    const result = await runGitHubAction({ baseBranch: 'main', workspaceDir: '/repo' }, harness.deps);

    expect(result.autoMerge).toBe('blocked');
    expect(result.reasonCodes).toEqual(['budget.frozen', 'plan.deferred']);
    const summary = harness.summaries.join('\n');
    expect(summary).toContain('The run PAUSED at its budget cap after 1 of 4 planned page(s); 3 were deferred.');
    expect(summary).toContain('`budget.frozen`');
  });

  it('a ledger regression against the base blocks the merge and names the regression', async () => {
    const harness = createHarness({
      decision: {
        autoMergeEligible: false,
        regressions: [
          { kind: 'badge-loss', pageId: 'pg_00000000000000000000', detail: 'the base page checked all 3 claims' }
        ],
        reasonCodes: ['ledger.regression']
      }
    });

    const result = await runGitHubAction({ baseBranch: 'main', workspaceDir: '/repo' }, harness.deps);

    expect(result.autoMerge).toBe('blocked');
    expect(harness.summaries.join('\n')).toContain('Guarantee downgrade (badge-loss) on page pg_00000000000000000000');
  });

  it('an undeclared dirty path is reported, excluded from the commit, and blocks the merge', async () => {
    const harness = createHarness({
      changedFiles: [
        'docs-site/content/en/getting-started/installation.mdx',
        '.docstube/manifest/manifest.json',
        'src/retry.ts'
      ],
      declaredPaths: ['docs-site/content/en/getting-started/installation.mdx', '.docstube/manifest/manifest.json']
    });

    const result = await runGitHubAction({ baseBranch: 'main', workspaceDir: '/repo' }, harness.deps);

    expect(result.autoMerge).toBe('blocked');
    expect(result.undeclaredPaths).toEqual(['src/retry.ts']);
    expect(result.committedPaths).not.toContain('src/retry.ts');
    expect(harness.operations.some((op) => op.startsWith('commit:') && op.includes('src/retry.ts'))).toBe(false);
    expect(harness.summaries.join('\n')).toContain('changed outside the declared output inventory');
  });

  it('a declared path whose bytes drifted from the recorded hash blocks the merge', async () => {
    const harness = createHarness();
    // Simulate a post-run write: the file on disk no longer matches the declared content hash.
    harness.deps.hashWorkspaceFile = async (path) =>
      path === '.docstube/manifest/manifest.json' ? sha256Hex('tampered') : undefined;

    const result = await runGitHubAction({ baseBranch: 'main', workspaceDir: '/repo' }, harness.deps);

    expect(result.autoMerge).toBe('blocked');
    expect(result.withheldReasons.join(' ')).toContain('no longer match the hash the run recorded');
  });
});

describe('inputs and CLI invocation', () => {
  it('runs the docstube CLI as a subprocess via npx in the workspace', async () => {
    const calls: { args: readonly string[]; command: string; cwd: string }[] = [];
    const runner = createDocstubeCliRunner('docstube@1.0.0', async (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd });
      return { exitCode: 0, stdout: 'ok', stderr: '' };
    });

    await expect(runner({ workspaceDir: '/repo' })).resolves.toEqual({ exitCode: 0, output: 'ok' });
    // The one supported command: generate (pipeline-v2 decision 1).
    expect(calls).toEqual([{ command: 'npx', args: ['--yes', 'docstube@1.0.0', 'generate', '--ci'], cwd: '/repo' }]);
  });

  it('creates deterministic branch names and concurrency groups', () => {
    expect(createDocstubeActionBranchName({ baseBranch: 'feature/docs!', branchPrefix: 'docstube updates' })).toBe(
      'docstube-updates/feature-docs'
    );
    expect(createDocstubeActionConcurrencyGroup({ refName: 'refs/heads/main', workflowName: 'Docs Update' })).toBe(
      'docstube-Docs-Update-main'
    );
  });

  it('reads inputs from the environment (no mode input exists anymore)', () => {
    const inputs = readGitHubActionInputsFromEnv({
      GITHUB_REPOSITORY: 'stacktape/docstube',
      GITHUB_WORKSPACE: '/repo',
      'INPUT_GITHUB-TOKEN': 'ghs_secret_token_123456'
    });

    expect(inputs).toMatchObject({
      githubToken: 'ghs_secret_token_123456',
      repository: 'stacktape/docstube',
      workspaceDir: '/repo'
    });
    expect(inputs).not.toHaveProperty('mode');
  });

  it('rejects the removed mode input instead of silently ignoring it (generate is the one command)', () => {
    for (const value of ['generate', 'refresh', 'validate']) {
      expect(() => readGitHubActionInputsFromEnv({ GITHUB_WORKSPACE: '/repo', INPUT_MODE: value })).toThrow(
        'The mode input was removed'
      );
    }
  });

  it('rejects the removed dry-run input instead of silently ignoring it', () => {
    expect(() => readGitHubActionInputsFromEnv({ GITHUB_WORKSPACE: '/repo', 'INPUT_DRY-RUN': 'true' })).toThrow(
      'dry-run input was removed'
    );
  });
});

const scriptedGitRunner = (failOnSubcommand?: string) => {
  const calls: string[][] = [];
  const run: GitHubActionProcessRunner = async (command, args) => {
    calls.push([command, ...args]);
    const failed = args[0] === failOnSubcommand;
    return { exitCode: failed ? 1 : 0, stderr: failed ? `${args[0]} failed` : '', stdout: '' };
  };
  return { calls, run };
};

describe('createGitClient.checkoutBase', () => {
  it('runs fetch, checkout, and ff-only pull in order on the happy path', async () => {
    const { calls, run } = scriptedGitRunner();
    await createGitClient(run).checkoutBase({ baseBranch: 'main', workspaceDir: '.' });
    expect(calls.map((call) => call[1])).toEqual(['fetch', 'checkout', 'pull']);
  });

  it('throws when fetch or pull fails instead of silently branching off a stale base', async () => {
    const fetchFailure = scriptedGitRunner('fetch');
    await expect(
      createGitClient(fetchFailure.run).checkoutBase({ baseBranch: 'main', workspaceDir: '.' })
    ).rejects.toThrow('fetch failed');
    // A failed fetch stops immediately — no checkout over unknown state.
    expect(fetchFailure.calls).toHaveLength(1);

    const pullFailure = scriptedGitRunner('pull');
    await expect(
      createGitClient(pullFailure.run).checkoutBase({ baseBranch: 'main', workspaceDir: '.' })
    ).rejects.toThrow('pull failed');
  });
});
