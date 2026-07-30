import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  buildDigestIssueBody,
  buildFlagCommentBody,
  buildJobSummary,
  buildPullRequestBody,
  digestIssueTitle,
  flagCommentMarker,
  planCommentUpsert,
  selectCommitPaths
} from './delta-report.ts';
import type { IssueComment } from './delta-report.ts';
import { decideAutoMerge, loadPublicationArtifacts, verifyOutputInventory } from './merge-decision.ts';
import type { AutoMergeDecision, InventoryCheck } from './merge-decision.ts';
import { loadVerifiedDelta } from './verified-delta.ts';
import type { VerifiedDelta, WorkspaceFileReader } from './verified-delta.ts';

// The action is an orchestrator, not the pipeline: it runs the docstube CLI as a subprocess in
// the workspace, reads the committed manifest for the verified delta, and handles git + GitHub
// (branch, atomic commit, PR, auto-merge gate, flag delivery). Honest L4 posture per PRODUCT §3.3.

// The Action runs exactly ONE docstube command: `generate`, the idempotent reconciler
// (pipeline-v2 decision 1). The former `mode` input (generate|refresh) is removed; a workflow
// still passing it fails with an actionable message instead of silently running something else.
export type GitHubActionInputs = {
  baseBranch?: string;
  branchPrefix?: string;
  commitMessage?: string;
  docstubePackage?: string;
  githubToken?: string;
  refName?: string;
  repository?: string;
  workflowName?: string;
  workspaceDir: string;
};

export type DocstubeCliRunResult = {
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
  paths: readonly string[];
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
  commitPaths: (input: GitCommitInput) => Promise<void>;
  createBranch: (input: GitBranchInput) => Promise<void>;
  // The revision the CLI generated against — what the publication decision must be bound to.
  // Undefined when HEAD cannot be read, which fails the binding check closed.
  headCommit: (input: { workspaceDir: string }) => Promise<string | undefined>;
  pushBranch: (input: GitBranchInput) => Promise<void>;
};

export type GitHubActionPullRequestClient = {
  createPullRequest: (input: PullRequestInput) => Promise<GitHubPullRequest>;
  findOpenPullRequest: (input: { baseBranch: string; branchName: string }) => Promise<GitHubPullRequest | undefined>;
  updatePullRequest: (input: PullRequestInput & { pullRequest: GitHubPullRequest }) => Promise<GitHubPullRequest>;
};

export type GitHubActionIssueClient = {
  listPullRequestComments: (input: { pullRequestNumber: number }) => Promise<readonly IssueComment[]>;
  createPullRequestComment: (input: { pullRequestNumber: number; body: string }) => Promise<void>;
  updateComment: (input: { commentId: number; body: string }) => Promise<void>;
  findOpenIssueByTitle: (input: { title: string }) => Promise<{ number: number } | undefined>;
  createIssue: (input: { title: string; body: string }) => Promise<void>;
  updateIssue: (input: { issueNumber: number; body: string }) => Promise<void>;
};

export type GitHubActionMergeControl = {
  // Enables GitHub native auto-merge (squash) on the PR. Throws when the repository does not
  // allow auto-merge; the orchestrator degrades gracefully (logs, leaves the PR open).
  enableAutoMerge: (input: { pullRequest: GitHubPullRequest }) => Promise<void>;
};

export type GitHubActionReporter = {
  appendSummary: (markdown: string) => Promise<void> | void;
  error: (message: string) => void;
  info: (message: string) => void;
  // GitHub Actions notice annotation (non-failing, surfaced on the run page).
  notice: (message: string) => void;
  setOutput: (name: string, value: string) => Promise<void> | void;
  warn: (message: string) => void;
};

export type GitHubActionDeps = {
  git: GitHubActionGitClient;
  issues: GitHubActionIssueClient;
  mergeControl: GitHubActionMergeControl;
  pullRequest: GitHubActionPullRequestClient;
  readWorkspaceFile: WorkspaceFileReader;
  // Content hash of a workspace file, over RAW BYTES — the output inventory covers emitted binary
  // assets too, so a utf8 round-trip would corrupt their hashes into false mismatches. Undefined
  // when the file does not exist.
  hashWorkspaceFile: (relativePath: string) => Promise<string | undefined>;
  reporter: GitHubActionReporter;
  runDocstube: (input: { workspaceDir: string }) => Promise<DocstubeCliRunResult>;
  // Ambient environment used for the model-credential precondition and secret redaction;
  // defaults to process.env.
  env?: NodeJS.ProcessEnv;
  // Latest published docstube version, or undefined when unavailable; failures must never fail
  // the action. Defaults to a short-timeout npm registry lookup.
  checkLatestDocstubeVersion?: () => Promise<string | undefined>;
};

export type GitHubActionAutoMergeState = 'enabled' | 'blocked' | 'unavailable' | 'skipped';

export type GitHubActionResult = {
  autoMerge: GitHubActionAutoMergeState;
  branchName: string;
  changed: boolean;
  changedFiles: readonly string[];
  committedPaths: readonly string[];
  concurrencyGroup: string;
  exitCode: number;
  openFlagCount: number;
  pullRequestNumber?: number;
  pullRequestUrl?: string;
  // The kernel's reason codes, verbatim, and the human-readable reasons the merge was withheld.
  reasonCodes: readonly string[];
  withheldReasons: readonly string[];
  // Dirty paths the run never declared: reported, never committed, and fatal to eligibility.
  undeclaredPaths: readonly string[];
  summary: string;
};

type ProcessRunResult = {
  exitCode: number;
  stderr: string;
  stdout: string;
};

export type GitHubActionProcessRunner = (
  command: string,
  args: readonly string[],
  options: { cwd: string; env?: Record<string, string | undefined> }
) => Promise<ProcessRunResult>;

export const actionPackageName = '@docstube/action';

const execFileAsync = promisify(execFile);
const defaultBranchPrefix = 'docstube/docs';
// Pinned to the version this action shipped with; kept in sync by scripts/release/set-version.ts.
const defaultDocstubePackage = 'docstube@0.0.2';

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

// Values of env vars whose NAME looks credential-shaped are scrubbed from anything the action
// logs or summarizes, in addition to the explicit github-token input.
const envSecretValues = (env: NodeJS.ProcessEnv): string[] =>
  Object.entries(env)
    .filter((entry): entry is [string, string] => {
      const [name, value] = entry;
      return /(KEY|TOKEN|SECRET)/.test(name) && typeof value === 'string' && value.length >= 4;
    })
    .map(([, value]) => value);

const commonCredentialEnvVars = [
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'OPENAI_API_KEY',
  'GOOGLE_API_KEY',
  'GEMINI_API_KEY'
];

// Env var names the repo's docstube.yml points at via `apiKeyEnv:`; a cheap regex scan rather
// than a YAML parse — a miss only widens the check to the common credential names.
const configuredApiKeyEnvVars = (configText: string | undefined): string[] =>
  configText === undefined
    ? []
    : [...configText.matchAll(/apiKeyEnv:\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/g)]
        .map((match) => match[1])
        .filter((name): name is string => name !== undefined);

export type CredentialCheckResult = { ok: true } | { ok: false; message: string };

// Fail fast with an actionable message when no plausible model credential is present, instead of
// letting the docstube CLI fail opaquely deep inside a transport.
export const checkModelCredential = async (input: {
  env: NodeJS.ProcessEnv;
  readWorkspaceFile: WorkspaceFileReader;
}): Promise<CredentialCheckResult> => {
  let configText: string | undefined;
  try {
    configText = await input.readWorkspaceFile('docstube.yml');
  } catch {
    configText = undefined;
  }
  const configured = configuredApiKeyEnvVars(configText);
  const candidates = configured.length > 0 ? configured : commonCredentialEnvVars;
  if (candidates.some((name) => (input.env[name] ?? '').length > 0)) {
    return { ok: true };
  }
  const source = configured.length > 0 ? 'docstube.yml names' : 'checked the common credential variables';
  return {
    ok: false,
    message:
      `No model credential found in the environment (${source}: ${candidates.join(', ')}). ` +
      'Pass the API key your docstube.yml agents need to this workflow step via `env:` (from a repository secret).'
  };
};

const pinnedVersionOf = (docstubePackage: string): string | undefined =>
  /^docstube@(\d+\.\d+\.\d+(?:-[a-z]+\.\d+)?)$/.exec(docstubePackage)?.[1];

const parseVersionParts = (version: string): number[] => (version.split('-')[0] ?? '').split('.').map(Number);

const isVersionBehind = (pinned: string, latest: string): boolean => {
  const [pinnedParts, latestParts] = [parseVersionParts(pinned), parseVersionParts(latest)];
  for (let index = 0; index < 3; index += 1) {
    if ((pinnedParts[index] ?? 0) < (latestParts[index] ?? 0)) {
      return true;
    }
    if ((pinnedParts[index] ?? 0) > (latestParts[index] ?? 0)) {
      return false;
    }
  }
  return false;
};

// Registry lookup with a short timeout; any failure returns undefined — never fails the action.
const fetchLatestDocstubeVersion = async (): Promise<string | undefined> => {
  try {
    const response = await fetch('https://registry.npmjs.org/docstube/latest', {
      signal: AbortSignal.timeout(5_000)
    });
    if (!response.ok) {
      return undefined;
    }
    const payload = (await response.json()) as { version?: unknown };
    return typeof payload.version === 'string' && /^\d+\.\d+\.\d+/.test(payload.version) ? payload.version : undefined;
  } catch {
    return undefined;
  }
};

const noticeWhenBehindLatest = async (input: {
  docstubePackage: string;
  checkLatest: () => Promise<string | undefined>;
  reporter: GitHubActionReporter;
}): Promise<void> => {
  const pinned = pinnedVersionOf(input.docstubePackage);
  if (pinned === undefined) {
    return;
  }
  try {
    const latest = await input.checkLatest();
    if (latest !== undefined && isVersionBehind(pinned, latest)) {
      input.reporter.notice(
        `docstube ${latest} is available (this run used the pinned ${pinned}). Update the action or set the docstube-package input.`
      );
    }
  } catch {
    // Version awareness is best-effort only.
  }
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

const setActionOutputs = async (reporter: GitHubActionReporter, result: GitHubActionResult): Promise<void> => {
  await reporter.setOutput('changed', String(result.changed));
  await reporter.setOutput('branch-name', result.branchName);
  await reporter.setOutput('concurrency-group', result.concurrencyGroup);
  await reporter.setOutput('auto-merge', result.autoMerge);
  await reporter.setOutput('open-flag-count', String(result.openFlagCount));
  await reporter.setOutput('committed-paths', JSON.stringify(result.committedPaths));
  await reporter.setOutput('publication-reason-codes', JSON.stringify(result.reasonCodes));
  await reporter.setOutput('undeclared-paths', JSON.stringify(result.undeclaredPaths));
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

const deliverFlags = async (input: {
  decision: AutoMergeDecision;
  deps: GitHubActionDeps;
  pullRequestNumber: number;
}): Promise<void> => {
  // PR comment always (PRODUCT decision log): one marker-tagged comment, find-and-update.
  const body = buildFlagCommentBody(input.decision.openFlags);
  const comments = await input.deps.issues.listPullRequestComments({ pullRequestNumber: input.pullRequestNumber });
  const plan = planCommentUpsert(comments, flagCommentMarker);
  if (plan.action === 'update') {
    await input.deps.issues.updateComment({ commentId: plan.commentId, body });
  } else {
    await input.deps.issues.createPullRequestComment({ pullRequestNumber: input.pullRequestNumber, body });
  }
};

const upsertTribalDigestIssue = async (input: {
  decision: AutoMergeDecision;
  deps: GitHubActionDeps;
}): Promise<void> => {
  const tribalFlags = input.decision.openFlags.filter((flag) => flag.kind === 'tribal-knowledge');
  const existing = await input.deps.issues.findOpenIssueByTitle({ title: digestIssueTitle });
  if (!existing && tribalFlags.length === 0) {
    return;
  }
  const body = buildDigestIssueBody(tribalFlags);
  if (existing) {
    await input.deps.issues.updateIssue({ issueNumber: existing.number, body });
  } else {
    await input.deps.issues.createIssue({ title: digestIssueTitle, body });
  }
};

export const runGitHubAction = async (
  inputs: GitHubActionInputs,
  deps: GitHubActionDeps
): Promise<GitHubActionResult> => {
  // The one supported command (pipeline-v2 decision 1) — kept as a named constant because the
  // job summary and PR body render it.
  const mode = 'generate';
  const baseBranch = inputs.baseBranch ?? 'main';
  const branchName = createDocstubeActionBranchName({ baseBranch, branchPrefix: inputs.branchPrefix });
  const concurrencyGroup = createDocstubeActionConcurrencyGroup({
    refName: inputs.refName ?? baseBranch,
    workflowName: inputs.workflowName
  });
  const env = deps.env ?? process.env;
  const secrets = [
    ...new Set(
      [inputs.githubToken, ...envSecretValues(env)].filter(
        (secret): secret is string => typeof secret === 'string' && secret.length > 0
      )
    )
  ];

  const emptyResult = (overrides: Partial<GitHubActionResult>): GitHubActionResult => ({
    autoMerge: 'skipped',
    branchName,
    changed: false,
    changedFiles: [],
    committedPaths: [],
    concurrencyGroup,
    exitCode: 0,
    openFlagCount: 0,
    reasonCodes: [],
    undeclaredPaths: [],
    withheldReasons: [],
    summary: '',
    ...overrides
  });

  deps.reporter.info(`Starting docstube ${mode}.`);

  const credential = await checkModelCredential({ env, readWorkspaceFile: deps.readWorkspaceFile });
  if (!credential.ok) {
    deps.reporter.error(credential.message);
    return completeAction(
      emptyResult({
        exitCode: 1,
        summary: buildJobSummary({
          autoMerge: 'skipped',
          committedPaths: [],
          decision: undefined,
          delta: undefined,
          failureOutput: credential.message,
          mode,
          status: 'failed'
        })
      }),
      deps.reporter,
      secrets
    );
  }

  await deps.git.checkoutBase({ baseBranch, workspaceDir: inputs.workspaceDir });
  await deps.git.createBranch({ branchName, workspaceDir: inputs.workspaceDir });
  // Read HEAD BEFORE the CLI runs: this is the revision the kernel generates against and the one
  // its decision must be bound to.
  const headCommit = await deps.git.headCommit({ workspaceDir: inputs.workspaceDir });

  const cliResult = await deps.runDocstube({ workspaceDir: inputs.workspaceDir });
  if (cliResult.exitCode !== 0) {
    return completeAction(
      emptyResult({
        exitCode: cliResult.exitCode,
        summary: buildJobSummary({
          autoMerge: 'skipped',
          committedPaths: [],
          decision: undefined,
          delta: undefined,
          failureOutput: cliResult.output,
          mode,
          status: 'failed'
        })
      }),
      deps.reporter,
      secrets
    );
  }

  // The CLI succeeded: nudge (never fail) when a newer docstube exists than the pinned default.
  await noticeWhenBehindLatest({
    docstubePackage: inputs.docstubePackage ?? defaultDocstubePackage,
    checkLatest: deps.checkLatestDocstubeVersion ?? fetchLatestDocstubeVersion,
    reporter: deps.reporter
  });

  const changedFiles = (await deps.git.changedFiles({ workspaceDir: inputs.workspaceDir })).toSorted();
  const candidatePaths = selectCommitPaths(changedFiles);

  // THE KERNEL'S DECISION IS THE AUTHORITY (PRODUCT §3.3). It is read before anything is staged,
  // because the inventory it carries is what decides which paths may be staged at all.
  const publication = await loadPublicationArtifacts({ headCommit, readWorkspaceFile: deps.readWorkspaceFile });
  let inventoryCheck: InventoryCheck | undefined;
  if (publication.ok) {
    inventoryCheck = await verifyOutputInventory({
      candidatePaths,
      hashWorkspaceFile: deps.hashWorkspaceFile,
      inventory: publication.inventory
    });
    for (const path of inventoryCheck.undeclaredPaths) {
      deps.reporter.warn(`\`${path}\` changed but the run never declared it — it will NOT be committed.`);
    }
  } else {
    deps.reporter.warn(`Auto-merge is not available for this run: ${publication.reason}`);
  }
  // With no valid inventory there is no allowlist, so nothing is staged beyond what the run itself
  // declared — an unvalidated candidate is reported, never committed silently under a merge gate it
  // never passed. The PR still opens (so a human can see the work) with everything the run touched.
  const committedPaths = inventoryCheck?.stagedPaths ?? candidatePaths;

  if (committedPaths.length === 0) {
    return completeAction(
      emptyResult({
        changedFiles,
        summary: buildJobSummary({
          autoMerge: 'skipped',
          committedPaths,
          decision: undefined,
          delta: undefined,
          mode,
          status: 'no-changes'
        })
      }),
      deps.reporter,
      secrets
    );
  }

  let delta: VerifiedDelta | undefined;
  try {
    delta = await loadVerifiedDelta({ changedFiles: committedPaths, readWorkspaceFile: deps.readWorkspaceFile });
  } catch (error) {
    deps.reporter.warn(`Could not compute the verified delta: ${(error as Error).message}`);
  }
  // The gate always runs, even when the manifest could not be read: an unreadable manifest is
  // missing evidence, and missing evidence must resolve to "do not auto-merge" rather than to no
  // decision at all.
  const decision = decideAutoMerge({
    flags: delta?.openFlags ?? [],
    inventory: inventoryCheck,
    publication:
      delta === undefined && publication.ok
        ? { ok: false, reason: 'the committed manifest could not be read, so the verified delta is unknown.' }
        : publication
  });

  // Docs + manifest shards + criteria/instructions ship atomically in one commit (ARCHITECTURE §5.3).
  await deps.git.commitPaths({
    message: inputs.commitMessage ?? `docs: docstube ${mode}`,
    paths: committedPaths,
    workspaceDir: inputs.workspaceDir
  });
  await deps.git.pushBranch({ branchName, workspaceDir: inputs.workspaceDir });

  const title = `docs: docstube ${mode}`;
  const body = buildPullRequestBody({ committedPaths, decision, delta, mode });
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

  let autoMerge: GitHubActionAutoMergeState = 'unavailable';
  if (pullRequest.number !== undefined) {
    if (decision.openFlags.length > 0) {
      await deliverFlags({ decision, deps, pullRequestNumber: pullRequest.number });
    }
    await upsertTribalDigestIssue({ decision, deps });
    if (decision.autoMerge) {
      try {
        await deps.mergeControl.enableAutoMerge({ pullRequest });
        autoMerge = 'enabled';
      } catch (error) {
        deps.reporter.warn(
          `Could not enable auto-merge (is it allowed in the repository settings?): ${(error as Error).message}`
        );
        autoMerge = 'unavailable';
      }
    } else {
      autoMerge = 'blocked';
      // Every withheld merge states itself — a blocked PR must never read as a silent no-op.
      for (const reason of decision.withheldReasons) {
        deps.reporter.info(`Auto-merge withheld: ${reason}`);
      }
    }
  } else {
    deps.reporter.warn('PR number unknown; cannot post flags or enable auto-merge.');
  }

  return completeAction(
    emptyResult({
      autoMerge,
      changed: true,
      changedFiles,
      committedPaths,
      openFlagCount: decision.openFlags.length,
      pullRequestNumber: pullRequest.number,
      pullRequestUrl: pullRequest.url,
      reasonCodes: decision.reasonCodes,
      undeclaredPaths: decision.undeclaredPaths,
      withheldReasons: decision.withheldReasons,
      summary: buildJobSummary({
        autoMerge,
        committedPaths,
        decision,
        delta,
        mode,
        pullRequestUrl: pullRequest.url,
        status: 'pull-request'
      })
    }),
    deps.reporter,
    secrets
  );
};

const runProcess: GitHubActionProcessRunner = async (command, args, options) => {
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

export const createGitClient = (run: GitHubActionProcessRunner = runProcess): GitHubActionGitClient => ({
  checkoutBase: async (input) => {
    // Every step is checked: a failed fetch or pull would silently branch the docs off a stale
    // base and the resulting PR would revert newer docs commits.
    const fetch = await run('git', ['fetch', 'origin', input.baseBranch, '--depth=1'], { cwd: input.workspaceDir });
    if (fetch.exitCode !== 0) {
      throw new Error(fetch.stderr || `Failed to fetch origin/${input.baseBranch}.`);
    }
    const checkout = await run('git', ['checkout', input.baseBranch], { cwd: input.workspaceDir });
    if (checkout.exitCode !== 0) {
      throw new Error(checkout.stderr || `Failed to checkout ${input.baseBranch}.`);
    }
    const pull = await run('git', ['pull', '--ff-only', 'origin', input.baseBranch], { cwd: input.workspaceDir });
    if (pull.exitCode !== 0) {
      throw new Error(pull.stderr || `Failed to fast-forward ${input.baseBranch} from origin.`);
    }
  },
  createBranch: async (input) => {
    const result = await run('git', ['checkout', '-B', input.branchName], { cwd: input.workspaceDir });
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || `Failed to create ${input.branchName}.`);
    }
  },
  headCommit: async (input) => {
    const result = await run('git', ['rev-parse', 'HEAD'], { cwd: input.workspaceDir });
    // An unreadable HEAD is never guessed at: undefined means the decision's revision binding
    // cannot be checked, and the gate is only ever as strong as what it can verify.
    return result.exitCode === 0 && result.stdout.trim().length > 0 ? result.stdout.trim() : undefined;
  },
  changedFiles: async (input) => {
    const result = await run('git', ['status', '--porcelain'], { cwd: input.workspaceDir });
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || 'Failed to read git status.');
    }
    return parsePorcelainStatus(result.stdout);
  },
  commitPaths: async (input) => {
    await run('git', ['config', 'user.name', 'github-actions[bot]'], { cwd: input.workspaceDir });
    await run('git', ['config', 'user.email', 'github-actions[bot]@users.noreply.github.com'], {
      cwd: input.workspaceDir
    });
    const add = await run('git', ['add', '--', ...input.paths], { cwd: input.workspaceDir });
    if (add.exitCode !== 0) {
      throw new Error(add.stderr || 'Failed to stage docstube changes.');
    }
    const commit = await run('git', ['commit', '-m', input.message], { cwd: input.workspaceDir });
    if (commit.exitCode !== 0) {
      throw new Error(commit.stderr || 'Failed to commit docstube changes.');
    }
  },
  pushBranch: async (input) => {
    const result = await run('git', ['push', '--force-with-lease', 'origin', `HEAD:refs/heads/${input.branchName}`], {
      cwd: input.workspaceDir
    });
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || `Failed to push ${input.branchName}.`);
    }
  }
});

const pullRequestNumberFromUrl = (url: string): number | undefined => {
  const match = url.match(/\/pull\/(\d+)\s*$/);
  return match?.[1] ? Number(match[1]) : undefined;
};

const parsePullRequest = (stdout: string): GitHubPullRequest | undefined => {
  const trimmed = stdout.trim();
  if (trimmed.length === 0 || trimmed === 'null') {
    return undefined;
  }

  const parsed = JSON.parse(trimmed) as { number?: unknown; url?: unknown };
  return typeof parsed.url === 'string'
    ? {
        number: typeof parsed.number === 'number' ? parsed.number : pullRequestNumberFromUrl(parsed.url),
        url: parsed.url
      }
    : undefined;
};

const ghEnvFor = (token?: string): Record<string, string> | undefined =>
  token ? { GH_TOKEN: token, GITHUB_TOKEN: token } : undefined;

const createPullRequestClient = (input: { token?: string | undefined }): GitHubActionPullRequestClient => {
  const ghEnv = ghEnvFor(input.token);

  return {
    findOpenPullRequest: async (query) => {
      const result = await runProcess(
        'gh',
        [
          'pr',
          'list',
          '--base',
          query.baseBranch,
          '--head',
          query.branchName,
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
    createPullRequest: async (create) => {
      const result = await runProcess(
        'gh',
        [
          'pr',
          'create',
          '--base',
          create.baseBranch,
          '--head',
          create.branchName,
          '--title',
          create.title,
          '--body',
          create.body
        ],
        { cwd: create.workspaceDir, env: ghEnv }
      );
      if (result.exitCode !== 0) {
        throw new Error(result.stderr || 'Failed to create docstube PR.');
      }
      const url = result.stdout.trim();
      return { number: pullRequestNumberFromUrl(url), url };
    },
    updatePullRequest: async (update) => {
      const selector = update.pullRequest.number ? String(update.pullRequest.number) : update.pullRequest.url;
      const result = await runProcess('gh', ['pr', 'edit', selector, '--title', update.title, '--body', update.body], {
        cwd: update.workspaceDir,
        env: ghEnv
      });
      if (result.exitCode !== 0) {
        throw new Error(result.stderr || 'Failed to update existing docstube PR.');
      }
      return update.pullRequest;
    }
  };
};

const createIssueClient = (input: {
  repository?: string | undefined;
  token?: string | undefined;
  workspaceDir: string;
}): GitHubActionIssueClient => {
  const ghEnv = ghEnvFor(input.token);
  const repoArgs = input.repository ? ['-R', input.repository] : [];
  const apiRepo = input.repository ?? '{owner}/{repo}';

  const runGh = async (args: readonly string[], failureMessage: string): Promise<string> => {
    const result = await runProcess('gh', args, { cwd: input.workspaceDir, env: ghEnv });
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || failureMessage);
    }
    return result.stdout;
  };

  return {
    listPullRequestComments: async ({ pullRequestNumber }) => {
      const stdout = await runGh(
        ['api', `repos/${apiRepo}/issues/${pullRequestNumber}/comments?per_page=100`],
        'Failed to list PR comments.'
      );
      const parsed = JSON.parse(stdout.trim() || '[]') as { id?: unknown; body?: unknown }[];
      return parsed
        .filter((comment) => typeof comment.id === 'number' && typeof comment.body === 'string')
        .map((comment) => ({ body: comment.body as string, id: comment.id as number }));
    },
    createPullRequestComment: async ({ pullRequestNumber, body }) => {
      await runGh(
        ['api', '-X', 'POST', `repos/${apiRepo}/issues/${pullRequestNumber}/comments`, '-f', `body=${body}`],
        'Failed to create the docstube flag comment.'
      );
    },
    updateComment: async ({ commentId, body }) => {
      await runGh(
        ['api', '-X', 'PATCH', `repos/${apiRepo}/issues/comments/${commentId}`, '-f', `body=${body}`],
        'Failed to update the docstube flag comment.'
      );
    },
    findOpenIssueByTitle: async ({ title }) => {
      const stdout = await runGh(
        ['issue', 'list', ...repoArgs, '--state', 'open', '--search', `"${title}" in:title`, '--json', 'number,title'],
        'Failed to search for the docstube digest issue.'
      );
      const parsed = JSON.parse(stdout.trim() || '[]') as { number?: unknown; title?: unknown }[];
      const match = parsed.find((issue) => issue.title === title && typeof issue.number === 'number');
      return match ? { number: match.number as number } : undefined;
    },
    createIssue: async ({ title, body }) => {
      await runGh(
        ['issue', 'create', ...repoArgs, '--title', title, '--body', body],
        'Failed to create the docstube digest issue.'
      );
    },
    updateIssue: async ({ issueNumber, body }) => {
      await runGh(
        ['issue', 'edit', String(issueNumber), ...repoArgs, '--body', body],
        'Failed to update the docstube digest issue.'
      );
    }
  };
};

const enableAutoMergeMutation =
  'mutation($pullRequestId: ID!) { enablePullRequestAutoMerge(input: { pullRequestId: $pullRequestId, mergeMethod: SQUASH }) { clientMutationId } }';

const createMergeControl = (input: { token?: string | undefined; workspaceDir: string }): GitHubActionMergeControl => {
  const ghEnv = ghEnvFor(input.token);

  return {
    enableAutoMerge: async ({ pullRequest }) => {
      const selector = pullRequest.number ? String(pullRequest.number) : pullRequest.url;
      const view = await runProcess('gh', ['pr', 'view', selector, '--json', 'id', '--jq', '.id'], {
        cwd: input.workspaceDir,
        env: ghEnv
      });
      if (view.exitCode !== 0 || view.stdout.trim().length === 0) {
        throw new Error(view.stderr || 'Failed to resolve the PR node id for auto-merge.');
      }
      const result = await runProcess(
        'gh',
        ['api', 'graphql', '-f', `query=${enableAutoMergeMutation}`, '-f', `pullRequestId=${view.stdout.trim()}`],
        { cwd: input.workspaceDir, env: ghEnv }
      );
      if (result.exitCode !== 0) {
        throw new Error(result.stderr || 'GitHub rejected enablePullRequestAutoMerge.');
      }
    }
  };
};

// `--ci` is not optional for the Action: it is what makes the run emit the publication decision the
// merge gate enforces. Without it every run would fail closed.
export const createDocstubeCliArgs = (input: { docstubePackage: string }): string[] => [
  '--yes',
  input.docstubePackage,
  'generate',
  '--ci'
];

export const createDocstubeCliRunner =
  (docstubePackage: string, processRunner: GitHubActionProcessRunner = runProcess) =>
  async (input: { workspaceDir: string }): Promise<DocstubeCliRunResult> => {
    const args = createDocstubeCliArgs({ docstubePackage });
    const result = await processRunner('npx', args, { cwd: input.workspaceDir });
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
  notice: (message) => console.info(`::notice::${message}`),
  setOutput: async (name, value) => {
    if (!env.GITHUB_OUTPUT) {
      return;
    }
    const delimiter = `docstube_${name.replace(/[^A-Za-z0-9_]/g, '_')}`;
    await appendFile(env.GITHUB_OUTPUT, `${name}<<${delimiter}\n${value}\n${delimiter}\n`, 'utf8');
  },
  warn: (message) => console.warn(message)
});

const createWorkspaceFileReader =
  (workspaceDir: string): WorkspaceFileReader =>
  async (relativePath) => {
    try {
      return await readFile(join(workspaceDir, relativePath), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }
      throw error;
    }
  };

// Raw-byte content hash, matching what the kernel recorded in the output inventory.
const createWorkspaceFileHasher =
  (workspaceDir: string) =>
  async (relativePath: string): Promise<string | undefined> => {
    try {
      return createHash('sha256')
        .update(await readFile(join(workspaceDir, relativePath)))
        .digest('hex');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }
      throw error;
    }
  };

export const createDefaultGitHubActionDeps = (input: {
  docstubePackage?: string;
  githubToken?: string;
  repository?: string;
  workspaceDir: string;
}): GitHubActionDeps => ({
  git: createGitClient(),
  issues: createIssueClient({
    repository: input.repository,
    token: input.githubToken,
    workspaceDir: input.workspaceDir
  }),
  mergeControl: createMergeControl({ token: input.githubToken, workspaceDir: input.workspaceDir }),
  pullRequest: createPullRequestClient({ token: input.githubToken }),
  readWorkspaceFile: createWorkspaceFileReader(input.workspaceDir),
  hashWorkspaceFile: createWorkspaceFileHasher(input.workspaceDir),
  reporter: createReporter(),
  runDocstube: createDocstubeCliRunner(input.docstubePackage ?? defaultDocstubePackage)
});

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

export const readGitHubActionInputsFromEnv = (env: NodeJS.ProcessEnv = process.env): GitHubActionInputs => {
  if (readActionInput(env, 'dry-run') !== undefined) {
    throw new Error('The dry-run input was removed; the docstube Action always opens a real PR.');
  }
  if (readActionInput(env, 'mode') !== undefined) {
    throw new Error(
      'The mode input was removed; the docstube Action always runs `docstube generate` (the idempotent reconciler). Drop the input from the workflow.'
    );
  }
  return {
    baseBranch: readActionInput(env, 'base-branch') ?? env.GITHUB_BASE_REF ?? env.GITHUB_REF_NAME ?? 'main',
    branchPrefix: readActionInput(env, 'branch-prefix'),
    commitMessage: readActionInput(env, 'commit-message'),
    docstubePackage: readActionInput(env, 'docstube-package'),
    githubToken: readActionInput(env, 'github-token') ?? env.GITHUB_TOKEN,
    refName: env.GITHUB_REF_NAME,
    repository: env.GITHUB_REPOSITORY,
    workflowName: env.GITHUB_WORKFLOW,
    workspaceDir: readActionInput(env, 'workspace') ?? env.GITHUB_WORKSPACE ?? process.cwd()
  };
};

export const runGitHubActionFromEnv = async (env: NodeJS.ProcessEnv = process.env): Promise<GitHubActionResult> => {
  const inputs = readGitHubActionInputsFromEnv(env);
  const deps = createDefaultGitHubActionDeps({
    docstubePackage: inputs.docstubePackage,
    githubToken: inputs.githubToken,
    repository: inputs.repository,
    workspaceDir: inputs.workspaceDir
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
