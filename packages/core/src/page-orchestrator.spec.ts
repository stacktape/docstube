import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReplayAgentAdapter } from '@docstube/agent';
import { buildSectionMarker } from '@docstube/contracts';
import { checkGeneratedPageSections } from '@docstube/verifiers';
import { describe, expect, it } from 'vitest';
import type { AgentReplayFixture, AgentRunInput, AgentTextArtifact } from '@docstube/agent';
import type { Finding, JsonValue, Timestamp } from '@docstube/contracts';
import { openDocstubeDatabase } from './db-migrations';
import { createLocalBackend } from './local-backend';
import type { ScheduledPage } from './pipeline-run';
import {
  createReviewerRunInput,
  createWriterRunInput,
  mergeFindings,
  runReplayPageGeneration
} from './page-orchestrator';

const timestamp: Timestamp = '2026-06-16T00:00:00.000Z';

const page: ScheduledPage = {
  id: 'overview',
  title: 'Overview',
  slug: 'overview.mdx',
  depth: 0,
  order: 0,
  brief: 'Explain the project.'
};

const generatedMdx = (body: string): string =>
  [
    '---',
    'id: overview',
    'title: Overview',
    'sections:',
    '  - intro',
    'generated:',
    '  by: docstube',
    '  version: "0.0.2"',
    `  at: "${timestamp}"`,
    '---',
    body
  ].join('\n');

const completedFixture = (input: AgentRunInput, options: { artifacts?: AgentTextArtifact[]; output?: JsonValue }) =>
  ({
    version: 1,
    name: input.taskId,
    recordedAt: timestamp,
    input,
    result: {
      adapterId: 'replay',
      adapterVersion: '0.0.0',
      status: 'completed',
      startedAt: timestamp,
      completedAt: timestamp,
      events: [
        {
          type: 'run-started',
          sequence: 0,
          timestamp,
          adapterId: 'replay',
          adapterVersion: '0.0.0',
          model: input.model,
          sandbox: input.sandbox
        },
        { type: 'run-completed', sequence: 1, timestamp, exitCode: 0 }
      ],
      artifacts: options.artifacts ?? [],
      output: options.output
    }
  }) satisfies AgentReplayFixture;

const makeRepoRoot = async () => mkdtemp(join(tmpdir(), 'docstube-page-orchestrator-'));

const sectionVerifier = {
  id: 'section-presence',
  run: checkGeneratedPageSections
};

describe('replay page generation orchestration', () => {
  it('passes a page when writer, reviewers, and deterministic verifiers pass', async () => {
    const repoRoot = await makeRepoRoot();
    const backend = createLocalBackend(openDocstubeDatabase(':memory:'));
    const runId = 'run-page-pass';
    const artifactContent = generatedMdx(
      [
        buildSectionMarker('start', 'intro'),
        '',
        '## Overview',
        '',
        'Verified overview.',
        '',
        buildSectionMarker('end', 'intro')
      ].join('\n')
    );
    const writerInput = createWriterRunInput({ runId, page, repoRoot });
    const reviewerInput = createReviewerRunInput({
      runId,
      page,
      repoRoot,
      personaId: 'developer',
      artifactContent
    });

    const result = await runReplayPageGeneration({
      backend,
      runId,
      repoRoot,
      page,
      writer: createReplayAgentAdapter(
        completedFixture(writerInput, {
          artifacts: [{ path: 'overview.mdx', content: artifactContent, encoding: 'utf8' }]
        })
      ),
      reviewers: [
        {
          personaId: 'developer',
          adapter: createReplayAgentAdapter(completedFixture(reviewerInput, { output: { findings: [] } }))
        }
      ],
      verifiers: [sectionVerifier],
      now: () => timestamp
    });

    expect(result.checkResults).toEqual([{ checkId: 'section-presence', status: 'passed' }]);
    expect(result.page).toMatchObject({ id: 'overview', status: 'passed', findings: [] });
    await expect(backend.getPage('overview')).resolves.toMatchObject({ status: 'passed', findings: [] });
    await backend.close();
  });

  it('flags and persists reproducible merged reviewer and verifier findings', async () => {
    const repoRoot = await makeRepoRoot();
    const backend = createLocalBackend(openDocstubeDatabase(':memory:'));
    const runId = 'run-page-flagged';
    const artifactContent = generatedMdx('## Overview\n\nMissing section markers.');
    const reviewerFinding: Finding = {
      code: 'persona-fit',
      severity: 'major',
      origin: 'reviewer',
      message: 'The developer persona needs an installation path.',
      pageId: 'overview'
    };
    const writerInput = createWriterRunInput({ runId, page, repoRoot });
    const reviewerInput = createReviewerRunInput({
      runId,
      page,
      repoRoot,
      personaId: 'developer',
      artifactContent
    });
    const writer = createReplayAgentAdapter(
      completedFixture(writerInput, {
        artifacts: [{ path: 'overview.mdx', content: artifactContent, encoding: 'utf8' }]
      })
    );
    const reviewer = createReplayAgentAdapter(
      completedFixture(reviewerInput, { output: { findings: [reviewerFinding] } })
    );
    const options = {
      backend,
      runId,
      repoRoot,
      page,
      writer,
      reviewers: [{ personaId: 'developer', adapter: reviewer }],
      verifiers: [sectionVerifier],
      now: () => timestamp
    };

    const first = await runReplayPageGeneration(options);
    const second = await runReplayPageGeneration(options);

    expect(first.page.status).toBe('flagged');
    expect(first.page.findings.map((finding) => finding.code).toSorted()).toEqual(['persona-fit', 'section-presence']);
    expect(second.page.findings).toEqual(first.page.findings);
    await expect(backend.getPage('overview')).resolves.toMatchObject({
      status: 'flagged',
      findings: first.page.findings
    });
    await backend.close();
  });

  it('deduplicates findings by stable finding identity', () => {
    const finding: Finding = {
      code: 'persona-fit',
      severity: 'major',
      origin: 'reviewer',
      message: 'Duplicate finding.',
      pageId: 'overview'
    };

    expect(mergeFindings([finding], [finding])).toEqual([finding]);
  });
});
