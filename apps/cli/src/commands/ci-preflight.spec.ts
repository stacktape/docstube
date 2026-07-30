import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CiPreflightCheck, CiPreflightCheckId, CiPreflightReport } from '@docstube/contracts';
import { createGitHubPreflightProbe, runCiPreflight } from './ci-preflight.ts';
import type { GitHubPreflightProbe } from './ci-preflight.ts';

// Nothing here touches the network, a vendor CLI, or a model: the binary probe and the whole
// GitHub client are injected, exactly as the Action's own specs inject git and gh.

let workspaceDir: string;

const baseConfig = (agents: string) => `schemaVersion: 1
docType: external-library
personas:
  - id: app-developer
    description: Builds apps
site:
  title: Fixture
${agents}`;

const validIa = `schemaVersion: 1
tree:
  - title: Getting started
    slug: getting-started
    brief: How to install and run.
`;

const writeConfig = async (agents: string) => {
  await writeFile(join(workspaceDir, 'docstube.yml'), baseConfig(agents), 'utf8');
  await writeFile(join(workspaceDir, 'ia.yml'), validIa, 'utf8');
};

const ciEnv = (overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  GITHUB_ACTIONS: 'true',
  GITHUB_REPOSITORY: 'stacktape/docstube',
  GITHUB_TOKEN: 'ghs_fixture_token',
  GITHUB_REF_NAME: 'main',
  DOCSTUBE_CI_BRANCH: 'docstube/docs/main',
  ...overrides
});

const okProbe = (overrides: Partial<GitHubPreflightProbe> = {}): GitHubPreflightProbe => ({
  tokenIdentity: async () => ({ ok: true, value: { kind: 'user', login: 'docs-bot' } }),
  repository: async () => ({
    ok: true,
    value: {
      permissions: { admin: false, maintain: false, push: true },
      allowAutoMerge: true,
      hasIssues: true,
      defaultBranch: 'main'
    }
  }),
  pullRequestAccess: async () => ({ ok: true, value: { listable: true } }),
  issueAccess: async () => ({ ok: true, value: { listable: true } }),
  branchPolicy: async () => ({
    ok: true,
    value: { protected: false, requiredStatusChecks: [], requiredApprovingReviewCount: 0 }
  }),
  branchExists: async () => ({ ok: true, value: false }),
  ...overrides
});

const findCheck = (report: CiPreflightReport, id: CiPreflightCheckId): CiPreflightCheck => {
  const found = report.checks.find((check) => check.id === id);
  if (found === undefined) {
    throw new Error(`no ${id} check in the report`);
  }
  return found;
};

beforeEach(async () => {
  workspaceDir = await mkdtemp(join(tmpdir(), 'docstube-preflight-'));
});

afterEach(async () => {
  await rm(workspaceDir, { recursive: true, force: true });
});

describe('CI preflight — transport credentials', () => {
  it('passes when the configured transport has its credential', async () => {
    await writeConfig('agents:\n  transport: anthropic-api\n');
    const report = await runCiPreflight({
      workspaceDir,
      mode: 'ci',
      env: ciEnv({ ANTHROPIC_API_KEY: 'sk-ant-fixture' }),
      probeBinary: async () => true,
      github: okProbe()
    });
    expect(findCheck(report, 'transport-credential').status).toBe('pass');
    expect(report.fatal).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('is fatal and names the env var when the configured transport has NO credential', async () => {
    await writeConfig('agents:\n  transport: anthropic-api\n  apiKeyEnv: MY_MODEL_KEY\n');
    const report = await runCiPreflight({
      workspaceDir,
      mode: 'ci',
      // A different provider's key is present; it is not the one this transport reads.
      env: ciEnv({ OPENAI_API_KEY: 'sk-openai-fixture' }),
      probeBinary: async () => true,
      github: okProbe()
    });
    const credential = findCheck(report, 'transport-credential');
    expect(credential.status).toBe('fail');
    expect(credential.detail).toContain('MY_MODEL_KEY');
    expect(credential.remedy).toContain('MY_MODEL_KEY');
    expect(report.fatal).toContain('transport-credential');
    expect(report.ok).toBe(false);
  });

  it('does not care that an UNRELATED provider credential is absent', async () => {
    await writeConfig('agents:\n  transport: claude-cli\n');
    const report = await runCiPreflight({
      workspaceDir,
      mode: 'ci',
      // No ANTHROPIC_API_KEY, no OPENAI_API_KEY — the claude CLI's own token is what matters.
      env: ciEnv({ CLAUDE_CODE_OAUTH_TOKEN: 'oauth-fixture' }),
      probeBinary: async () => true,
      github: okProbe()
    });
    expect(findCheck(report, 'transport-credential').status).toBe('pass');
    expect(report.ok).toBe(true);
  });

  // ROLE ROUTING IS PART OF THE CREDENTIAL SURFACE: `agents.roles` can send reviews or translations
  // to a second provider, and a key only that role needs must fail HERE, not mid-run.
  it('is fatal when a ROLE-OVERRIDDEN transport has no credential, even though the writer does', async () => {
    await writeConfig(
      'agents:\n  transport: claude-cli\n  roles:\n    reviewer:\n      transport: anthropic-api\n      model: claude-haiku-5\n'
    );
    const report = await runCiPreflight({
      workspaceDir,
      mode: 'ci',
      // The writer's vendor-CLI token is present; the reviewer's provider key is not.
      env: ciEnv({ CLAUDE_CODE_OAUTH_TOKEN: 'oauth-fixture' }),
      probeBinary: async () => true,
      github: okProbe()
    });
    const credential = findCheck(report, 'transport-credential');
    expect(credential.status).toBe('fail');
    expect(credential.detail).toContain('reviewer');
    expect(credential.detail).toContain('ANTHROPIC_API_KEY');
    expect(report.fatal).toContain('transport-credential');
    expect(report.ok).toBe(false);
  });

  it('passes — and reports both routings — when every role that moved has its credential', async () => {
    await writeConfig(
      'agents:\n  transport: claude-cli\n  roles:\n    reviewer:\n      transport: anthropic-api\n      model: claude-haiku-5\n'
    );
    const report = await runCiPreflight({
      workspaceDir,
      mode: 'ci',
      env: ciEnv({ CLAUDE_CODE_OAUTH_TOKEN: 'oauth-fixture', ANTHROPIC_API_KEY: 'sk-ant-fixture' }),
      probeBinary: async () => true,
      github: okProbe()
    });
    expect(findCheck(report, 'transport-credential').status).toBe('pass');
    const resolution = findCheck(report, 'transport-resolution');
    expect(resolution.detail).toContain('claude-cli');
    expect(resolution.detail).toContain('anthropic-api');
    expect(resolution.detail).toContain('reviewer');
    expect(report.ok).toBe(true);
  });

  it('is fatal when a role-overridden transport resolves NO model', async () => {
    await writeConfig('agents:\n  transport: claude-cli\n  roles:\n    translator:\n      transport: codex-cli\n');
    const report = await runCiPreflight({
      workspaceDir,
      mode: 'ci',
      env: ciEnv({ CLAUDE_CODE_OAUTH_TOKEN: 'oauth-fixture', OPENAI_API_KEY: 'sk-openai' }),
      probeBinary: async () => true,
      github: okProbe()
    });
    const resolution = findCheck(report, 'transport-resolution');
    expect(resolution.status).toBe('fail');
    expect(resolution.detail).toContain('agents.roles.translator.model');
    expect(report.fatal).toContain('transport-resolution');
  });

  it('is fatal when a vendor CLI transport has no binary on PATH', async () => {
    await writeConfig('agents:\n  transport: codex-cli\n  model: gpt-5\n');
    const report = await runCiPreflight({
      workspaceDir,
      mode: 'ci',
      env: ciEnv({ OPENAI_API_KEY: 'sk-openai-fixture' }),
      probeBinary: async (binary) => binary !== 'codex',
      github: okProbe()
    });
    const credential = findCheck(report, 'transport-credential');
    expect(credential.status).toBe('fail');
    expect(credential.detail).toContain('`codex` is not on PATH');
    expect(report.fatal).toContain('transport-credential');
  });

  it('is fatal in CI when a vendor CLI is present but no unattended token is set', async () => {
    await writeConfig('agents:\n  transport: claude-cli\n');
    const report = await runCiPreflight({
      workspaceDir,
      mode: 'ci',
      env: ciEnv(),
      probeBinary: async () => true,
      github: okProbe()
    });
    expect(findCheck(report, 'transport-credential').status).toBe('fail');
    expect(findCheck(report, 'transport-credential').detail).toContain('interactive login');
  });

  it('reports the same case as UNKNOWN on a developer machine, never a pass and never fatal', async () => {
    await writeConfig('agents:\n  transport: claude-cli\n');
    const report = await runCiPreflight({
      workspaceDir,
      mode: 'local',
      env: {},
      probeBinary: async () => true
    });
    expect(findCheck(report, 'transport-credential').status).toBe('unknown');
    expect(report.ok).toBe(true);
  });

  it('passes a keyless local endpoint that legitimately needs no key', async () => {
    await writeConfig(
      'agents:\n  transport: openai-compatible\n  model: llama3\n  baseUrl: http://127.0.0.1:11434/v1\n'
    );
    const report = await runCiPreflight({
      workspaceDir,
      mode: 'ci',
      env: ciEnv(),
      probeBinary: async () => true,
      github: okProbe()
    });
    expect(findCheck(report, 'transport-credential').status).toBe('pass');
    expect(report.ok).toBe(true);
  });

  it('refuses to call a keyless HOSTED endpoint configured — it would 401 mid-run', async () => {
    await writeConfig('agents:\n  transport: openai-compatible\n  model: gpt-5\n');
    const report = await runCiPreflight({
      workspaceDir,
      mode: 'ci',
      env: ciEnv({ OPENAI_API_KEY: 'sk-set-but-not-referenced' }),
      probeBinary: async () => true,
      github: okProbe()
    });
    const credential = findCheck(report, 'transport-credential');
    expect(credential.status).toBe('fail');
    expect(credential.detail).toContain('api.openai.com');
    expect(credential.remedy).toContain('agents.apiKeyEnv');
  });

  it('resolves the transport the run will ACTUALLY use, including the internal override', async () => {
    await writeConfig('agents:\n  transport: anthropic-api\n');
    const report = await runCiPreflight({
      workspaceDir,
      mode: 'local',
      env: { DOCSTUBE_TRANSPORT_OVERRIDE: 'replay' },
      probeBinary: async () => true
    });
    expect(findCheck(report, 'transport-resolution').detail).toContain('replay');
    // The replay transport makes no live calls, so no credential is demanded.
    expect(findCheck(report, 'transport-credential').status).toBe('pass');
  });

  it('is fatal when the config family itself cannot be loaded', async () => {
    await writeFile(join(workspaceDir, 'docstube.yml'), 'schemaVersion: 1\ndocType: nope\n', 'utf8');
    await writeFile(join(workspaceDir, 'ia.yml'), validIa, 'utf8');
    const report = await runCiPreflight({ workspaceDir, mode: 'local', env: {}, probeBinary: async () => true });
    expect(findCheck(report, 'config-family').status).toBe('fail');
    expect(findCheck(report, 'transport-resolution').status).toBe('unknown');
    expect(report.fatal).toEqual(['config-family']);
  });
});

describe('CI preflight — GitHub permissions and auto-merge honesty', () => {
  beforeEach(async () => {
    await writeConfig('agents:\n  transport: anthropic-api\n');
  });

  const run = (github: GitHubPreflightProbe, env: NodeJS.ProcessEnv = {}) =>
    runCiPreflight({
      workspaceDir,
      mode: 'ci',
      env: ciEnv({ ANTHROPIC_API_KEY: 'sk-ant-fixture', ...env }),
      probeBinary: async () => true,
      github
    });

  it('is fatal with a remedy when the token cannot write to the repository', async () => {
    const report = await run(
      okProbe({
        repository: async () => ({
          ok: true,
          value: {
            permissions: { admin: false, maintain: false, push: false },
            allowAutoMerge: true,
            hasIssues: true,
            defaultBranch: 'main'
          }
        })
      })
    );
    const write = findCheck(report, 'github-repository-write');
    expect(write.status).toBe('fail');
    expect(write.remedy).toContain('contents: write');
    expect(report.fatal).toContain('github-repository-write');
    expect(report.ok).toBe(false);
  });

  it('is fatal with a remedy when the token cannot touch pull requests', async () => {
    const report = await run(okProbe({ pullRequestAccess: async () => ({ ok: true, value: { listable: false } }) }));
    expect(findCheck(report, 'github-pull-requests').status).toBe('fail');
    expect(findCheck(report, 'github-pull-requests').remedy).toContain('pull-requests: write');
    expect(report.fatal).toContain('github-pull-requests');
  });

  it('reports a plain GITHUB_TOKEN as approval-assisted rather than full-auto', async () => {
    const report = await run(okProbe({ tokenIdentity: async () => ({ ok: true, value: { kind: 'installation' } }) }));
    expect(findCheck(report, 'auto-merge-token-mode').status).toBe('warn');
    expect(report.automationMode).toBe('approval-assisted');
    expect(report.automationReason).toContain('workflow');
    // Nothing about the token blocks the run — the PR still opens, it just is not full-auto.
    expect(report.ok).toBe(true);
  });

  it('claims full-auto only when every precondition is proven', async () => {
    const report = await run(okProbe());
    expect(report.automationMode).toBe('full-auto');
  });

  it('reports auto-merge being disabled on the repository instead of silently assuming it', async () => {
    const report = await run(
      okProbe({
        repository: async () => ({
          ok: true,
          value: {
            permissions: { admin: false, maintain: false, push: true },
            allowAutoMerge: false,
            hasIssues: true,
            defaultBranch: 'main'
          }
        })
      })
    );
    const autoMerge = findCheck(report, 'auto-merge-repository');
    expect(autoMerge.status).toBe('warn');
    expect(autoMerge.detail).toContain('does NOT allow auto-merge');
    expect(report.automationMode).toBe('manual');
    expect(report.ok).toBe(true);
  });

  it('degrades to approval-assisted (never full-auto) when the branch policy cannot be read', async () => {
    const report = await run(
      okProbe({ branchPolicy: async () => ({ ok: false, reason: 'GitHub answered 403 (needs admin rights)' }) })
    );
    expect(findCheck(report, 'auto-merge-branch-policy').status).toBe('unknown');
    expect(findCheck(report, 'auto-merge-branch-policy').detail).toContain('403');
    expect(report.automationMode).toBe('approval-assisted');
    expect(report.ok).toBe(true);
  });

  it('warns about a required approving review rather than promising an unattended merge', async () => {
    const report = await run(
      okProbe({
        branchPolicy: async () => ({
          ok: true,
          value: { protected: true, requiredStatusChecks: ['build'], requiredApprovingReviewCount: 1 }
        })
      })
    );
    expect(findCheck(report, 'auto-merge-branch-policy').status).toBe('warn');
    expect(report.automationMode).toBe('approval-assisted');
  });

  it('reports an already-existing docs branch as a concurrency risk, not a failure', async () => {
    const report = await run(okProbe({ branchExists: async () => ({ ok: true, value: true }) }));
    const branch = findCheck(report, 'branch-state');
    expect(branch.status).toBe('warn');
    expect(branch.detail).toContain('docstube/docs/main');
    expect(report.ok).toBe(true);
  });

  it('warns when issues are disabled so the tribal-knowledge digest has nowhere to land', async () => {
    const report = await run(
      okProbe({
        repository: async () => ({
          ok: true,
          value: {
            permissions: { admin: false, maintain: false, push: true },
            allowAutoMerge: true,
            hasIssues: false,
            defaultBranch: 'main'
          }
        })
      })
    );
    expect(findCheck(report, 'github-issues').status).toBe('warn');
    expect(report.ok).toBe(true);
  });

  it('reports UNKNOWN with a reason — never a pass — when a probe refuses to answer', async () => {
    const report = await run(okProbe({ repository: async () => ({ ok: false, reason: 'GitHub answered 502' }) }));
    expect(findCheck(report, 'github-repository-write').status).toBe('unknown');
    expect(findCheck(report, 'github-repository-write').detail).toContain('502');
    // An unknown blocking check is reported, not enforced.
    expect(report.fatal).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('reports every GitHub check as unknown outside a GitHub Actions context and still succeeds', async () => {
    const report = await runCiPreflight({
      workspaceDir,
      mode: 'ci',
      env: { ANTHROPIC_API_KEY: 'sk-ant-fixture' },
      probeBinary: async () => true
    });
    for (const id of [
      'github-context',
      'github-repository-write',
      'github-pull-requests',
      'github-issues',
      'auto-merge-repository',
      'auto-merge-branch-policy',
      'auto-merge-token-mode',
      'branch-state'
    ] as const) {
      expect(findCheck(report, id).status).toBe('unknown');
      expect(findCheck(report, id).detail).toContain('not running in a GitHub Actions context');
    }
    expect(report.automationMode).toBe('unknown');
    expect(report.ok).toBe(true);
  });

  it('is fatal when running in Actions with no token at all', async () => {
    const report = await runCiPreflight({
      workspaceDir,
      mode: 'ci',
      env: { ANTHROPIC_API_KEY: 'sk-ant-fixture', GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'stacktape/docstube' },
      probeBinary: async () => true
    });
    expect(findCheck(report, 'github-context').status).toBe('fail');
    expect(report.fatal).toContain('github-context');
  });
});

describe('CI preflight — default GitHub probe', () => {
  it('maps GitHub responses onto probe results without a real network call', async () => {
    const responses = new Map<string, { status: number; body: unknown }>([
      ['/user', { status: 403, body: {} }],
      [
        '/repos/o/r',
        {
          status: 200,
          body: {
            permissions: { admin: false, push: true },
            allow_auto_merge: true,
            has_issues: true,
            default_branch: 'main'
          }
        }
      ],
      ['/repos/o/r/branches/main/protection', { status: 404, body: {} }],
      ['/repos/o/r/branches/docs-x', { status: 200, body: {} }]
    ]);
    const probe = createGitHubPreflightProbe({
      apiUrl: 'https://api.github.test',
      repository: 'o/r',
      token: 'fixture',
      fetchImpl: (async (url: string) => {
        const path = url.replace('https://api.github.test', '');
        const hit = responses.get(path) ?? { status: 500, body: {} };
        return { status: hit.status, json: async () => hit.body } as unknown as Response;
      }) as unknown as typeof fetch
    });

    expect(await probe.tokenIdentity()).toEqual({ ok: true, value: { kind: 'installation' } });
    const repo = await probe.repository();
    expect(repo).toMatchObject({ ok: true, value: { allowAutoMerge: true, permissions: { push: true } } });
    expect(await probe.branchPolicy({ branch: 'main' })).toEqual({
      ok: true,
      value: { protected: false, requiredStatusChecks: [], requiredApprovingReviewCount: 0 }
    });
    expect(await probe.branchExists({ branch: 'docs-x' })).toEqual({ ok: true, value: true });
    // An answer the probe cannot interpret is a reason, never a silent pass.
    expect(await probe.pullRequestAccess()).toMatchObject({ ok: false });
  });
});
