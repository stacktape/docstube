import { describe, expect, it } from 'vitest';
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
      '.docstube/runs/run_1/journal.jsonl'
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
    const decision = decideAutoMerge(delta?.openFlags ?? []);

    const body = buildPullRequestBody({
      committedPaths: [shardRelativePath(shard), 'docs-site/content/en/getting-started/installation.mdx'],
      decision,
      delta,
      mode: 'refresh'
    });

    expect(body).toContain('## docstube refresh');
    expect(body).toContain('| `getting-started/installation` (en) | 1 | 1 | 0 | 1 |');
    expect(body).toContain('Totals: 1 checked · 1 unchecked · 0 contradicted claim(s).');
    expect(body).toContain('### Open flags (1)');
    expect(body).toContain('**out-of-domain** — why was legacyInit deprecated?');
    expect(body).toContain('Auto-merge: blocked by 1 open flag.');
    expect(body).toContain('- `docs-site/content/en/getting-started/installation.mdx`');
  });

  it('declares auto-merge eligibility when no flag blocks', () => {
    const body = buildPullRequestBody({
      committedPaths: ['docs-site/content/en/index.mdx'],
      decision: decideAutoMerge([]),
      delta: { changedPages: [], totals: { checked: 0, unchecked: 0, contradicted: 0 }, openFlags: [] },
      mode: 'generate'
    });
    expect(body).toContain('No open flags. This PR is eligible for auto-merge.');
    expect(body).toContain('Auto-merge: eligible — no open flag blocks this change.');
  });

  it('is honest when no verified delta exists', () => {
    const body = buildPullRequestBody({
      committedPaths: ['docs-site/content/en/index.mdx'],
      decision: undefined,
      delta: undefined,
      mode: 'generate'
    });
    expect(body).toContain('No manifest index was found, so no verified delta could be computed.');
    expect(body).toContain('Auto-merge: not attempted');
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
      decision: decideAutoMerge([]),
      delta: { changedPages: [], totals: { checked: 0, unchecked: 0, contradicted: 0 }, openFlags: [] },
      mode: 'refresh',
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
