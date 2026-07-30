import { describe, expect, it } from 'vitest';
import { buildFixtureStructuralFinding } from '@docstube/contracts';
import {
  buildDigestIssueBody,
  buildFlagCommentBody,
  buildJobSummary,
  buildPullRequestBody,
  digestIssueMarker,
  flagCommentMarker,
  planCommentUpsert,
  selectCommitPaths
} from './delta-report.ts';
import { decideAutoMerge } from './merge-decision.ts';
import {
  buildFixtureFlag,
  buildFixtureShardWithFlags,
  buildFixtureWorkspace,
  fixturePublicationValidation,
  shardRelativePath
} from './test-support.ts';
import { loadVerifiedDelta } from './verified-delta.ts';

describe('atomic commit path selection', () => {
  it('ships docs, manifest shards, criteria, and instructions together and excludes machine-local state', () => {
    const paths = selectCommitPaths([
      'docs-site/content/en/installation.mdx',
      '.docstube/manifest/manifest.json',
      '.docstube\\manifest\\pages\\en\\pg_00000000000000000000.json',
      '.docstube/criteria/audience-fit.md',
      '.docstube/instructions/tone.md',
      '.docstube/knowledge/ts-abc.md',
      '.docstube/db.sqlite',
      '.docstube/db.sqlite-wal',
      '.docstube/cache/agent-calls/abc.json',
      '.docstube/runs/run_1/journal.jsonl',
      // Staged-atomic publish (pipeline-v2 decision 3): completed-but-UNPUBLISHED work. Committing
      // it would put a half-applied plan on the PR under a gate it never passed.
      '.docstube/staging/state.json',
      '.docstube/staging/out/content/en/installation.mdx',
      '.docstube\\staging\\manifest\\pages\\en\\pg_00000000000000000000.json'
    ]);

    expect(paths).toEqual([
      '.docstube/criteria/audience-fit.md',
      '.docstube/instructions/tone.md',
      '.docstube/knowledge/ts-abc.md',
      '.docstube/manifest/manifest.json',
      '.docstube/manifest/pages/en/pg_00000000000000000000.json',
      'docs-site/content/en/installation.mdx'
    ]);
  });
});

describe('PR body (verified delta annotation)', () => {
  it('renders claim counts per page and the flags section from manifest fixtures', async () => {
    const shard = buildFixtureShardWithFlags([
      buildFixtureFlag({
        kind: 'out-of-domain',
        summary: 'why was legacyInit deprecated?',
        entity: { version: 'latest', locale: 'en', pageId: 'pg_00000000000000000000' }
      })
    ]);
    const workspace = buildFixtureWorkspace({ shards: [shard] });
    const delta = await loadVerifiedDelta({
      changedFiles: [shardRelativePath(shard)],
      readWorkspaceFile: workspace.readWorkspaceFile
    });
    const decision = decideAutoMerge({ flags: delta?.openFlags ?? [], publication: fixturePublicationValidation() });

    const body = buildPullRequestBody({
      committedPaths: [shardRelativePath(shard), 'docs-site/content/en/getting-started/installation.mdx'],
      decision,
      delta,
      mode: 'generate'
    });

    expect(body).toContain('## docstube generate');
    expect(body).toContain('| `getting-started/installation` (en) | 1 | 1 | 0 | 1 |');
    expect(body).toContain('Totals: 1 checked · 1 unchecked · 0 contradicted claim(s).');
    expect(body).toContain('### Open flags (1)');
    expect(body).toContain('**out-of-domain** — why was legacyInit deprecated?');
    expect(body).toContain('Auto-merge: **withheld**.');
    expect(body).toContain('1 open blocking flag (out-of-domain).');
    expect(body).toContain('- `docs-site/content/en/getting-started/installation.mdx`');
  });

  it('gives structural quality its own section and always labels it nonblocking', () => {
    const finding = buildFixtureStructuralFinding();
    const body = buildPullRequestBody({
      committedPaths: [],
      decision: decideAutoMerge({ flags: [], publication: fixturePublicationValidation() }),
      delta: {
        changedPages: [],
        totals: { checked: 0, unchecked: 0, contradicted: 0 },
        openFlags: [],
        structural: { openPageFindings: 2, openGroupFindings: 1, open: [finding] }
      },
      mode: 'generate'
    });
    expect(body).toContain('### Structural quality');
    expect(body).toContain('Structural quality: 3 open · nonblocking');
    expect(body).toContain('`structure.sibling-facet-asymmetry`');
    expect(body).toContain('AI-assessed');
    // Never the vocabulary of proof.
    expect(body).not.toContain('verified defect');
  });

  it('says so plainly when there is no structural work', () => {
    const body = buildPullRequestBody({
      committedPaths: [],
      decision: decideAutoMerge({ flags: [], publication: fixturePublicationValidation() }),
      delta: {
        changedPages: [],
        totals: { checked: 0, unchecked: 0, contradicted: 0 },
        openFlags: [],
        structural: { openPageFindings: 0, openGroupFindings: 0, open: [] }
      },
      mode: 'generate'
    });
    expect(body).toContain('Structural quality: 0 open · nonblocking');
    expect(body).toContain('No open structural findings.');
  });

  it('reports the kernel decision plainly when the candidate is eligible', () => {
    const body = buildPullRequestBody({
      committedPaths: ['docs-site/content/en/index.mdx'],
      decision: decideAutoMerge({ flags: [], publication: fixturePublicationValidation() }),
      delta: {
        changedPages: [],
        totals: { checked: 0, unchecked: 0, contradicted: 0 },
        openFlags: [],
        structural: { openPageFindings: 0, openGroupFindings: 0, open: [] }
      },
      mode: 'generate'
    });
    // The flags section no longer declares eligibility — only the kernel decision does.
    expect(body).toContain('No open flags.');
    expect(body).not.toContain('eligible for auto-merge');
    expect(body).toContain('Execution: **completed** — 1 of 1 planned page(s) completed, 0 deferred.');
    expect(body).toContain('Auto-merge: **enabled**');
  });

  it('states why a withheld merge was withheld, including the reason codes', () => {
    const body = buildPullRequestBody({
      committedPaths: ['docs-site/content/en/index.mdx'],
      decision: decideAutoMerge({
        flags: [],
        publication: fixturePublicationValidation({
          execution: 'paused-budget',
          plan: { planned: 4, completed: 1, deferred: 3 },
          publishable: false,
          autoMergeEligible: false,
          reasonCodes: ['budget.frozen', 'plan.deferred']
        })
      }),
      delta: {
        changedPages: [],
        totals: { checked: 0, unchecked: 0, contradicted: 0 },
        openFlags: [],
        structural: { openPageFindings: 0, openGroupFindings: 0, open: [] }
      },
      mode: 'generate'
    });
    expect(body).toContain('Execution: **paused-budget**');
    expect(body).toContain('`budget.frozen`');
    expect(body).toContain('The run PAUSED at its budget cap');
  });

  it('is honest when the run produced no enforceable decision', () => {
    const body = buildPullRequestBody({
      committedPaths: ['docs-site/content/en/index.mdx'],
      decision: decideAutoMerge({ flags: [], publication: { ok: false, reason: 'artifact absent.' } }),
      delta: undefined,
      mode: 'generate'
    });
    expect(body).toContain('No manifest index was found, so no verified delta could be computed.');
    expect(body).toContain('No enforceable publication decision: artifact absent.');
    expect(body).toContain('Auto-merge: **withheld**.');
  });
});

describe('flag comment', () => {
  it('is marker-tagged and lists every open flag with kind, summary, and entity address', () => {
    const body = buildFlagCommentBody([
      buildFixtureFlag({
        kind: 'guarantee-downgrade',
        summary: 'installation snippet dropped from proven to scored',
        entity: {
          version: 'latest',
          locale: 'en',
          pageId: 'pg_00000000000000000000',
          entityId: 'bl_00000000000000000000'
        }
      }),
      buildFixtureFlag({ kind: 'coverage', summary: 'partial coverage declared on packages/core' })
    ]);

    expect(body.startsWith(flagCommentMarker)).toBe(true);
    expect(body).toContain('2 open flags require attention');
    expect(body).toContain(
      '- **guarantee-downgrade** — installation snippet dropped from proven to scored (`latest/en/pg_00000000000000000000#bl_00000000000000000000`)'
    );
    expect(body).toContain('- **coverage** — partial coverage declared on packages/core');
  });

  it('updates the marker-tagged comment when found and creates one otherwise', () => {
    const comments = [
      { id: 1, body: 'unrelated human comment' },
      { id: 2, body: `${flagCommentMarker}\nolder flag report` }
    ];
    expect(planCommentUpsert(comments, flagCommentMarker)).toEqual({ action: 'update', commentId: 2 });
    expect(planCommentUpsert([comments[0]!], flagCommentMarker)).toEqual({ action: 'create' });
    expect(planCommentUpsert([], flagCommentMarker)).toEqual({ action: 'create' });
  });
});

describe('tribal-knowledge digest issue body', () => {
  it('lists open questions with symbol and flag id, marker-tagged', () => {
    const body = buildDigestIssueBody([
      buildFixtureFlag({
        kind: 'tribal-knowledge',
        summary: 'deprecation reason unknown',
        question: 'Why was legacyInit deprecated in 2.0?',
        subjectSymbol: `ts:${'a'.repeat(64)}`,
        id: 'fl_00000000000000000000'
      })
    ]);

    expect(body.startsWith(digestIssueMarker)).toBe(true);
    expect(body).toContain('- Why was legacyInit deprecated in 2.0?');
    expect(body).toContain(`  - symbol: \`ts:${'a'.repeat(64)}\``);
    expect(body).toContain('  - flag: `fl_00000000000000000000`');
  });

  it('states there are no open questions when the list is empty', () => {
    expect(buildDigestIssueBody([])).toContain('No open questions right now.');
  });
});

describe('job summary', () => {
  it('reports the delta and the auto-merge decision', () => {
    const summary = buildJobSummary({
      autoMerge: 'enabled',
      committedPaths: ['docs-site/content/en/index.mdx'],
      decision: decideAutoMerge({ flags: [], publication: fixturePublicationValidation() }),
      delta: {
        changedPages: [],
        totals: { checked: 0, unchecked: 0, contradicted: 0 },
        openFlags: [],
        structural: { openPageFindings: 0, openGroupFindings: 0, open: [] }
      },
      mode: 'generate',
      pullRequestUrl: 'https://github.com/stacktape/docstube/pull/12',
      status: 'pull-request'
    });
    expect(summary).toContain('https://github.com/stacktape/docstube/pull/12');
    expect(summary).toContain('Auto-merge enabled (squash).');
  });

  it('reports failure output without pretending anything shipped', () => {
    const summary = buildJobSummary({
      autoMerge: 'skipped',
      committedPaths: [],
      decision: undefined,
      delta: undefined,
      failureOutput: 'codemap failed',
      mode: 'generate',
      status: 'failed'
    });
    expect(summary).toContain('did not complete successfully');
    expect(summary).toContain('codemap failed');
  });
});
