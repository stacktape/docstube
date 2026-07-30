import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { CiAutomationMode, CiPreflightCheck, CiPreflightCheckId, CiPreflightReport } from '@docstube/contracts';
import { ciPreflightReportSchema } from '@docstube/contracts';
import {
  CoreError,
  credentialEnvVarPresent,
  detectProject,
  docstubeVersion,
  loadConfigFamily,
  resolveTransportCredentialRequirement
} from '@docstube/core';
import type { TransportCredentialRequirement } from '@docstube/core';

// THE CI PREFLIGHT (quality-ci-reader-v2 decision 14). Everything a CI run needs, checked BEFORE
// any model spend: the configured transport resolves and its credential is present, the GitHub
// token can actually write to the repository and open PRs, and the auto-merge story is labeled
// honestly rather than assumed.
//
// ZERO MODEL SPEND, ALWAYS. This command resolves and inspects; it never calls a model. The one
// live model call docstube makes is the setup wizard's opt-in transport preflight, which is a
// different thing and stays opt-in.
//
// HONESTY RULE: a check that cannot be performed reports `unknown` WITH ITS REASON. Unknown is
// never a pass and never — by itself — fatal.

const execFileAsync = promisify(execFile);

export type GitHubProbeResult<T> = { ok: true; value: T } | { ok: false; reason: string };

export type GitHubTokenIdentity =
  // A user-to-server or personal access token: PRs it opens DO trigger workflows.
  | { kind: 'user'; login: string }
  // A GitHub App installation token. The workflow's own GITHUB_TOKEN is one of these, and GitHub
  // will not run workflows for the PRs it opens without a human approval.
  | { kind: 'installation' };

export type GitHubRepositoryFacts = {
  permissions: { admin: boolean; maintain: boolean; push: boolean };
  allowAutoMerge: boolean;
  hasIssues: boolean;
  defaultBranch: string;
};

export type GitHubBranchPolicy = {
  protected: boolean;
  requiredStatusChecks: readonly string[];
  requiredApprovingReviewCount: number;
};

// Every GitHub fact the preflight needs, behind one injectable seam so tests never touch the
// network (the Action's specs use the same discipline for git and gh).
export type GitHubPreflightProbe = {
  tokenIdentity: () => Promise<GitHubProbeResult<GitHubTokenIdentity>>;
  repository: () => Promise<GitHubProbeResult<GitHubRepositoryFacts>>;
  pullRequestAccess: () => Promise<GitHubProbeResult<{ listable: boolean }>>;
  issueAccess: () => Promise<GitHubProbeResult<{ listable: boolean }>>;
  branchPolicy: (input: { branch: string }) => Promise<GitHubProbeResult<GitHubBranchPolicy>>;
  branchExists: (input: { branch: string }) => Promise<GitHubProbeResult<boolean>>;
};

export type CiPreflightInput = {
  workspaceDir: string;
  // 'ci' adds the GitHub half; 'local' runs only what a developer machine can answer.
  mode: 'ci' | 'local';
  env?: NodeJS.ProcessEnv;
  probeBinary?: (binary: string) => Promise<boolean>;
  // Injected by tests and by callers that already hold a client. Omitted in production: the
  // default probe is built from the ambient GitHub Actions environment.
  github?: GitHubPreflightProbe | undefined;
  now?: () => Date;
};

const binaryOnPath = async (binary: string): Promise<boolean> => {
  try {
    await execFileAsync(binary, ['--version'], { timeout: 10_000, shell: process.platform === 'win32' });
    return true;
  } catch {
    return false;
  }
};

const check = (
  id: CiPreflightCheckId,
  title: string,
  status: CiPreflightCheck['status'],
  blocking: boolean,
  detail: string,
  remedy?: string
): CiPreflightCheck => ({ id, title, status, blocking, detail, ...(remedy === undefined ? {} : { remedy }) });

// --- the default GitHub probe -------------------------------------------------------------

export const gitHubActionsContext = (
  env: NodeJS.ProcessEnv
): { repository: string; token: string; apiUrl: string; baseBranch: string; branchName?: string } | undefined => {
  const repository = env.GITHUB_REPOSITORY ?? '';
  if (env.GITHUB_ACTIONS !== 'true' || repository === '') {
    return undefined;
  }
  const token = (env.GITHUB_TOKEN ?? env.GH_TOKEN ?? '').trim();
  return {
    repository,
    token,
    apiUrl: env.GITHUB_API_URL ?? 'https://api.github.com',
    baseBranch: env.DOCSTUBE_CI_BASE_BRANCH ?? env.GITHUB_BASE_REF ?? env.GITHUB_REF_NAME ?? 'main',
    // The Action passes the exact branch it will push; the fallback mirrors its default prefix.
    ...(env.DOCSTUBE_CI_BRANCH === undefined ? {} : { branchName: env.DOCSTUBE_CI_BRANCH })
  };
};

type GitHubResponse = { status: number; body: unknown };

export const createGitHubPreflightProbe = (input: {
  apiUrl: string;
  repository: string;
  token: string;
  fetchImpl?: typeof fetch;
}): GitHubPreflightProbe => {
  const fetchImpl = input.fetchImpl ?? fetch;
  const request = async (path: string): Promise<GitHubProbeResult<GitHubResponse>> => {
    try {
      const response = await fetchImpl(`${input.apiUrl}${path}`, {
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${input.token}`,
          'x-github-api-version': '2022-11-28'
        },
        signal: AbortSignal.timeout(10_000)
      });
      const body = await response.json().catch(() => undefined);
      return { ok: true, value: { status: response.status, body } };
    } catch (error) {
      return { ok: false, reason: `GitHub API request to ${path} failed: ${(error as Error).message}` };
    }
  };

  const repoPath = `/repos/${input.repository}`;

  return {
    tokenIdentity: async () => {
      const result = await request('/user');
      if (!result.ok) {
        return result;
      }
      const { status, body } = result.value;
      if (status === 200) {
        const login = (body as { login?: unknown } | undefined)?.login;
        return { ok: true, value: { kind: 'user', login: typeof login === 'string' ? login : 'unknown' } };
      }
      // Installation tokens (the workflow's own GITHUB_TOKEN among them) are forbidden from /user.
      if (status === 403) {
        return { ok: true, value: { kind: 'installation' } };
      }
      return { ok: false, reason: `GitHub answered ${status} for the token identity lookup` };
    },
    repository: async () => {
      const result = await request(repoPath);
      if (!result.ok) {
        return result;
      }
      const { status, body } = result.value;
      if (status !== 200) {
        return { ok: false, reason: `GitHub answered ${status} for ${repoPath}` };
      }
      const repo = body as {
        permissions?: { admin?: unknown; maintain?: unknown; push?: unknown };
        allow_auto_merge?: unknown;
        has_issues?: unknown;
        default_branch?: unknown;
      };
      return {
        ok: true,
        value: {
          permissions: {
            admin: repo.permissions?.admin === true,
            maintain: repo.permissions?.maintain === true,
            push: repo.permissions?.push === true
          },
          allowAutoMerge: repo.allow_auto_merge === true,
          hasIssues: repo.has_issues === true,
          defaultBranch: typeof repo.default_branch === 'string' ? repo.default_branch : 'main'
        }
      };
    },
    pullRequestAccess: async () => {
      const result = await request(`${repoPath}/pulls?per_page=1`);
      if (!result.ok) {
        return result;
      }
      const { status } = result.value;
      if (status === 200) {
        return { ok: true, value: { listable: true } };
      }
      if (status === 403 || status === 404) {
        return { ok: true, value: { listable: false } };
      }
      return { ok: false, reason: `GitHub answered ${status} when listing pull requests` };
    },
    issueAccess: async () => {
      const result = await request(`${repoPath}/issues?per_page=1`);
      if (!result.ok) {
        return result;
      }
      const { status } = result.value;
      if (status === 200) {
        return { ok: true, value: { listable: true } };
      }
      if (status === 403 || status === 404) {
        return { ok: true, value: { listable: false } };
      }
      return { ok: false, reason: `GitHub answered ${status} when listing issues` };
    },
    branchPolicy: async ({ branch }) => {
      const result = await request(`${repoPath}/branches/${encodeURIComponent(branch)}/protection`);
      if (!result.ok) {
        return result;
      }
      const { status, body } = result.value;
      if (status === 404) {
        // GitHub answers 404 for an unprotected branch — the branch itself is checked separately.
        return { ok: true, value: { protected: false, requiredStatusChecks: [], requiredApprovingReviewCount: 0 } };
      }
      if (status !== 200) {
        return {
          ok: false,
          reason: `GitHub answered ${status} for the branch-protection lookup (reading protection needs admin rights)`
        };
      }
      const policy = body as {
        required_status_checks?: { contexts?: unknown };
        required_pull_request_reviews?: { required_approving_review_count?: unknown };
      };
      const contexts = policy.required_status_checks?.contexts;
      const reviews = policy.required_pull_request_reviews?.required_approving_review_count;
      return {
        ok: true,
        value: {
          protected: true,
          requiredStatusChecks: Array.isArray(contexts)
            ? contexts.filter((c): c is string => typeof c === 'string')
            : [],
          requiredApprovingReviewCount: typeof reviews === 'number' ? reviews : 0
        }
      };
    },
    branchExists: async ({ branch }) => {
      const result = await request(`${repoPath}/branches/${encodeURIComponent(branch)}`);
      if (!result.ok) {
        return result;
      }
      const { status } = result.value;
      if (status === 200) {
        return { ok: true, value: true };
      }
      if (status === 404) {
        return { ok: true, value: false };
      }
      return { ok: false, reason: `GitHub answered ${status} for the branch lookup` };
    }
  };
};

// --- the checks ---------------------------------------------------------------------------

const localRuntimeChecks = async (input: {
  workspaceDir: string;
  probe: (binary: string) => Promise<boolean>;
}): Promise<CiPreflightCheck[]> => {
  const checks: CiPreflightCheck[] = [];
  const [nodeMajor = 0] = process.versions.node.split('.').map(Number);
  checks.push(
    check(
      'node-runtime',
      'node',
      nodeMajor >= 24 ? 'pass' : 'fail',
      true,
      `v${process.versions.node} (need >= 24)`,
      nodeMajor >= 24 ? undefined : 'Pin the workflow to Node 24 or newer (actions/setup-node with node-version: 24).'
    )
  );
  checks.push(
    check(
      'git-binary',
      'git',
      (await input.probe('git')) ? 'pass' : 'fail',
      true,
      'required for provenance commits',
      'Install git, or use a runner image that ships it.'
    )
  );

  const detection = await detectProject(input.workspaceDir);
  if (detection.languages.includes('python')) {
    const { resolvePythonInterpreter } = await import('@docstube/lang-python');
    const interpreter = await resolvePythonInterpreter();
    checks.push(
      check(
        'language-toolchain',
        'python',
        interpreter === undefined ? 'fail' : 'pass',
        true,
        interpreter ?? 'documenting a Python repo requires a python interpreter (3.9+) on PATH',
        interpreter === undefined ? 'Add actions/setup-python (3.9+) before the docstube step.' : undefined
      )
    );
  }
  checks.push(
    check(
      'project-detection',
      'project detection',
      detection.languages.length > 0 ? 'pass' : 'warn',
      false,
      detection.languages.length > 0
        ? `${detection.languages.join(', ')}${detection.docType ? ` · looks like ${detection.docType}` : ''}${detection.monorepo ? ' · monorepo' : ''}`
        : 'no supported language detected (TypeScript, Python, Java)'
    )
  );
  return checks;
};

const transportChecks = (input: {
  requirement: TransportCredentialRequirement;
  env: NodeJS.ProcessEnv;
  binaryPresent: boolean | undefined;
  mode: 'ci' | 'local';
}): CiPreflightCheck[] => {
  const { requirement, env } = input;
  const checks: CiPreflightCheck[] = [];

  if (requirement.configProblem !== undefined) {
    checks.push(
      check(
        'transport-resolution',
        'transport',
        'fail',
        true,
        requirement.configProblem,
        'Set `agents.model` in docstube.yml — this transport has no default model.'
      )
    );
    return checks;
  }
  checks.push(
    check(
      'transport-resolution',
      'transport',
      'pass',
      true,
      `${requirement.transportId} · model ${requirement.model}${requirement.endpoint ? ` · ${requirement.endpoint}` : ''}`
    )
  );

  const present = credentialEnvVarPresent(requirement, env);

  if (requirement.kind === 'vendor-cli') {
    const binary = requirement.binary ?? requirement.transportId;
    if (input.binaryPresent === false) {
      checks.push(
        check(
          'transport-credential',
          'transport credential',
          'fail',
          true,
          `\`${binary}\` is not on PATH, and agents.transport is ${requirement.transportId}`,
          `Install the ${binary} CLI in the job before the docstube step, or switch agents.transport to an API transport.`
        )
      );
      return checks;
    }
    if (present !== undefined) {
      checks.push(
        check(
          'transport-credential',
          'transport credential',
          'pass',
          true,
          `\`${binary}\` is on PATH and ${present} is set`
        )
      );
      return checks;
    }
    // A vendor CLI with no token env var: on a developer machine an interactive login may well be
    // in place (unprovable without a billable call); an unattended runner has no such login.
    checks.push(
      input.mode === 'ci'
        ? check(
            'transport-credential',
            'transport credential',
            'fail',
            true,
            `\`${binary}\` is on PATH but none of ${requirement.credentialEnvVars.join(', ')} is set, and an unattended runner cannot complete an interactive login`,
            `Pass ${requirement.credentialEnvVars[0]} to the docstube step via \`env:\` from a repository secret.`
          )
        : check(
            'transport-credential',
            'transport credential',
            'unknown',
            true,
            `\`${binary}\` is on PATH; none of ${requirement.credentialEnvVars.join(', ')} is set, so this run would rely on an interactive login that cannot be verified without a billable call`
          )
    );
    return checks;
  }

  if (requirement.kind === 'keyless') {
    if (requirement.endpointIsPrivate === true) {
      checks.push(
        check(
          'transport-credential',
          'transport credential',
          'pass',
          true,
          `${requirement.transportId} needs no credential${requirement.endpoint ? ` — ${requirement.endpoint} is a local endpoint` : ''}`
        )
      );
      return checks;
    }
    checks.push(
      check(
        'transport-credential',
        'transport credential',
        'fail',
        true,
        `agents.apiKeyEnv is unset, so no authorization header is sent — but ${requirement.endpoint} is a hosted endpoint that requires a key`,
        'Set `agents.apiKeyEnv` in docstube.yml to the env var holding the key, or point `agents.baseUrl` at a local keyless server.'
      )
    );
    return checks;
  }

  const envVar = requirement.credentialEnvVars[0] ?? 'the configured credential';
  checks.push(
    present !== undefined
      ? check('transport-credential', 'transport credential', 'pass', true, `${present} is set`)
      : check(
          'transport-credential',
          'transport credential',
          'fail',
          true,
          `agents.transport is ${requirement.transportId} and ${envVar} is not set in this environment`,
          `Pass ${envVar} to the docstube step via \`env:\` from a repository secret. Other providers' keys are irrelevant — this transport reads only ${envVar}.`
        )
  );
  return checks;
};

const unknownGitHubChecks = (reason: string): CiPreflightCheck[] => [
  check('github-context', 'github context', 'unknown', true, reason),
  check('github-repository-write', 'github write access', 'unknown', true, reason),
  check('github-pull-requests', 'github pull requests', 'unknown', true, reason),
  check('github-issues', 'github issues', 'unknown', false, reason),
  check('auto-merge-repository', 'auto-merge (repository)', 'unknown', false, reason),
  check('auto-merge-branch-policy', 'auto-merge (branch policy)', 'unknown', false, reason),
  check('auto-merge-token-mode', 'auto-merge (token)', 'unknown', false, reason),
  check('branch-state', 'branch state', 'unknown', false, reason)
];

const gitHubChecks = async (input: {
  probe: GitHubPreflightProbe;
  baseBranch: string;
  branchName: string;
  repository: string;
}): Promise<CiPreflightCheck[]> => {
  const checks: CiPreflightCheck[] = [];
  checks.push(check('github-context', 'github context', 'pass', true, `GitHub Actions · ${input.repository}`));

  const repository = await input.probe.repository();
  if (repository.ok) {
    const { permissions, allowAutoMerge, hasIssues } = repository.value;
    checks.push(
      permissions.push
        ? check(
            'github-repository-write',
            'github write access',
            'pass',
            true,
            `the token has write access to ${input.repository}`
          )
        : check(
            'github-repository-write',
            'github write access',
            'fail',
            true,
            `the token cannot write to ${input.repository}, so the docs branch could never be pushed`,
            'Add `permissions: contents: write` to the workflow job, or supply a token with repository write access.'
          )
    );
    checks.push(
      allowAutoMerge
        ? check('auto-merge-repository', 'auto-merge (repository)', 'pass', false, 'the repository allows auto-merge')
        : check(
            'auto-merge-repository',
            'auto-merge (repository)',
            'warn',
            false,
            'the repository does NOT allow auto-merge, so the docs PR will wait for a human merge',
            'Enable "Allow auto-merge" in the repository settings if you want unattended merges.'
          )
    );
    checks.push(
      hasIssues
        ? check('github-issues', 'github issues', 'pass', false, 'issues are enabled for the tribal-knowledge digest')
        : check(
            'github-issues',
            'github issues',
            'warn',
            false,
            'issues are disabled on this repository, so the tribal-knowledge digest issue cannot be created',
            'Enable issues, or accept that maintainer questions arrive only on the PR comment.'
          )
    );
  } else {
    for (const id of ['github-repository-write', 'auto-merge-repository', 'github-issues'] as const) {
      checks.push(
        check(
          id,
          id === 'github-repository-write'
            ? 'github write access'
            : id === 'auto-merge-repository'
              ? 'auto-merge (repository)'
              : 'github issues',
          'unknown',
          id === 'github-repository-write',
          repository.reason
        )
      );
    }
  }

  const pulls = await input.probe.pullRequestAccess();
  checks.push(
    !pulls.ok
      ? check('github-pull-requests', 'github pull requests', 'unknown', true, pulls.reason)
      : pulls.value.listable
        ? check(
            'github-pull-requests',
            'github pull requests',
            'pass',
            true,
            'the token can read pull requests; opening and commenting on them uses the same scope'
          )
        : check(
            'github-pull-requests',
            'github pull requests',
            'fail',
            true,
            'the token cannot access pull requests, so the docs PR and its flag comment would fail after generation had already billed',
            'Add `permissions: pull-requests: write` to the workflow job.'
          )
  );

  const identity = await input.probe.tokenIdentity();
  checks.push(
    !identity.ok
      ? check('auto-merge-token-mode', 'auto-merge (token)', 'unknown', false, identity.reason)
      : identity.value.kind === 'user'
        ? check(
            'auto-merge-token-mode',
            'auto-merge (token)',
            'pass',
            false,
            `the token authenticates as ${identity.value.login}; PRs it opens trigger workflows normally`
          )
        : check(
            'auto-merge-token-mode',
            'auto-merge (token)',
            'warn',
            false,
            "the token is a GitHub App installation token — the workflow's own GITHUB_TOKEN is one of these, and GitHub does not run workflows for the PRs it opens. Required checks will not start on their own",
            'Use a GitHub App token or PAT with a supported branch policy for full-auto; otherwise expect to approve the workflow run on each docs PR.'
          )
  );

  const policy = await input.probe.branchPolicy({ branch: input.baseBranch });
  checks.push(
    !policy.ok
      ? check('auto-merge-branch-policy', 'auto-merge (branch policy)', 'unknown', false, policy.reason)
      : !policy.value.protected
        ? check(
            'auto-merge-branch-policy',
            'auto-merge (branch policy)',
            'pass',
            false,
            `${input.baseBranch} has no branch protection — auto-merge completes as soon as it is enabled`
          )
        : policy.value.requiredApprovingReviewCount > 0
          ? check(
              'auto-merge-branch-policy',
              'auto-merge (branch policy)',
              'warn',
              false,
              `${input.baseBranch} requires ${policy.value.requiredApprovingReviewCount} approving review(s), so auto-merge waits for a human`,
              'Drop the review requirement for the docs branch, or accept approval-assisted merges.'
            )
          : check(
              'auto-merge-branch-policy',
              'auto-merge (branch policy)',
              'pass',
              false,
              `${input.baseBranch} requires ${policy.value.requiredStatusChecks.length} status check(s) and no approving review`
            )
  );

  const branch = await input.probe.branchExists({ branch: input.branchName });
  checks.push(
    !branch.ok
      ? check('branch-state', 'branch state', 'unknown', false, branch.reason)
      : branch.value
        ? check(
            'branch-state',
            'branch state',
            'warn',
            false,
            `\`${input.branchName}\` already exists — this run force-updates it (--force-with-lease), and a concurrent run on the same branch will be rejected`,
            'Set the workflow `concurrency` group before the job so queued runs coalesce.'
          )
        : check('branch-state', 'branch state', 'pass', false, `\`${input.branchName}\` does not exist yet`)
  );

  return checks;
};

const statusOf = (
  checks: readonly CiPreflightCheck[],
  id: CiPreflightCheckId
): CiPreflightCheck['status'] | undefined => checks.find((entry) => entry.id === id)?.status;

// The label the user gets to believe. Nothing rounds up: an unknown auto-merge precondition means
// approval-assisted, never full-auto (quality-ci-reader-v2 decision 14).
export const deriveAutomationMode = (
  checks: readonly CiPreflightCheck[],
  mode: 'ci' | 'local'
): { automationMode: CiAutomationMode; automationReason: string } => {
  if (mode === 'local' || statusOf(checks, 'github-context') === 'unknown') {
    return {
      automationMode: 'unknown',
      automationReason: 'no GitHub Actions context — the merge story cannot be determined from here.'
    };
  }
  if (statusOf(checks, 'auto-merge-repository') === 'warn') {
    return {
      automationMode: 'manual',
      automationReason: 'the repository does not allow auto-merge, so every docs PR waits for a human merge.'
    };
  }
  const token = statusOf(checks, 'auto-merge-token-mode');
  if (token !== 'pass') {
    return {
      automationMode: 'approval-assisted',
      automationReason:
        token === 'warn'
          ? "PRs opened with the workflow's GITHUB_TOKEN do not trigger workflow runs, so the required checks need a human to approve them."
          : 'the token identity could not be established, so full-auto is not claimed.'
    };
  }
  const policy = statusOf(checks, 'auto-merge-branch-policy');
  if (policy !== 'pass') {
    return {
      automationMode: 'approval-assisted',
      automationReason:
        policy === 'warn'
          ? 'the target branch requires an approving review, so auto-merge waits for a human.'
          : 'the branch policy could not be read, so full-auto is not claimed.'
    };
  }
  if (statusOf(checks, 'auto-merge-repository') !== 'pass') {
    return {
      automationMode: 'approval-assisted',
      automationReason: 'the repository auto-merge setting could not be read, so full-auto is not claimed.'
    };
  }
  return {
    automationMode: 'full-auto',
    automationReason: 'the token, the repository setting, and the branch policy all permit an unattended merge.'
  };
};

export const runCiPreflight = async (input: CiPreflightInput): Promise<CiPreflightReport> => {
  const env = input.env ?? process.env;
  const probe = input.probeBinary ?? binaryOnPath;
  const checks: CiPreflightCheck[] = [...(await localRuntimeChecks({ workspaceDir: input.workspaceDir, probe }))];

  try {
    const family = await loadConfigFamily(input.workspaceDir);
    checks.push(check('config-family', 'config family', 'pass', true, 'docstube.yml + ia.yml valid'));
    let requirement: TransportCredentialRequirement | undefined;
    try {
      requirement = resolveTransportCredentialRequirement(family.config, env);
    } catch (error) {
      checks.push(
        check(
          'transport-resolution',
          'transport',
          'fail',
          true,
          error instanceof CoreError ? (error.message.split('\n')[0] ?? 'unresolvable') : 'unresolvable'
        )
      );
    }
    if (requirement !== undefined) {
      const binaryPresent = requirement.binary === undefined ? undefined : await probe(requirement.binary);
      checks.push(...transportChecks({ requirement, env, binaryPresent, mode: input.mode }));
    }
  } catch (error) {
    // An unusable docstube.yml means every pipeline command will fail — never start one.
    checks.push(
      check(
        'config-family',
        'config family',
        'fail',
        true,
        error instanceof CoreError ? (error.message.split('\n')[0] ?? 'invalid') : 'unreadable',
        'Run `docstube validate` locally and fix docstube.yml / ia.yml before the workflow runs.'
      )
    );
    checks.push(
      check(
        'transport-resolution',
        'transport',
        'unknown',
        true,
        'the config could not be loaded, so no transport was resolved'
      )
    );
  }

  if (input.mode === 'ci') {
    const context = gitHubActionsContext(env);
    if (context === undefined) {
      checks.push(
        ...unknownGitHubChecks(
          'not running in a GitHub Actions context (GITHUB_ACTIONS/GITHUB_REPOSITORY unset) — GitHub permissions, auto-merge, and branch state were not checked'
        )
      );
    } else if (context.token === '' && input.github === undefined) {
      checks.push(
        check(
          'github-context',
          'github context',
          'fail',
          true,
          `running in GitHub Actions for ${context.repository}, but no GITHUB_TOKEN/GH_TOKEN is available — the run could generate docs and then fail to open a PR`,
          'Pass `github-token: ${{ secrets.GITHUB_TOKEN }}` to the docstube action step.'
        )
      );
      checks.push(...unknownGitHubChecks('no GitHub token was available to probe with').slice(1));
    } else {
      const gitHubProbe =
        input.github ??
        createGitHubPreflightProbe({ apiUrl: context.apiUrl, repository: context.repository, token: context.token });
      checks.push(
        ...(await gitHubChecks({
          probe: gitHubProbe,
          baseBranch: context.baseBranch,
          branchName: context.branchName ?? `docstube/docs/${context.baseBranch.replace(/\//g, '-')}`,
          repository: context.repository
        }))
      );
    }
  }

  const fatal = checks.filter((entry) => entry.blocking && entry.status === 'fail').map((entry) => entry.id);
  const { automationMode, automationReason } = deriveAutomationMode(checks, input.mode);

  return ciPreflightReportSchema.parse({
    schemaVersion: 1,
    toolVersion: docstubeVersion,
    generatedAt: (input.now ?? (() => new Date()))().toISOString(),
    mode: input.mode,
    automationMode,
    automationReason,
    checks,
    ok: fatal.length === 0,
    fatal
  });
};

const statusLabel: Record<CiPreflightCheck['status'], string> = {
  pass: 'ok  ',
  fail: 'FAIL',
  warn: 'warn',
  unknown: '?   '
};

// The plain-text rendering both `docstube doctor` and the Action's job summary read.
export const renderCiPreflightReport = (report: CiPreflightReport): string[] => {
  const lines = report.checks.map(
    (entry) =>
      `${statusLabel[entry.status]}  ${entry.title} — ${entry.detail}${entry.remedy ? `\n      → ${entry.remedy}` : ''}`
  );
  if (report.mode === 'ci') {
    lines.push(`Automation mode: ${report.automationMode} — ${report.automationReason}`);
  }
  return lines;
};
