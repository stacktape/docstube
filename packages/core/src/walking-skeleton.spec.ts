import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createReplayAgentAdapter } from '@docstube/agent';
import { describe, expect, it } from 'vitest';
import { openDocstubeDatabase } from './db-migrations';
import { createLocalBackend } from './local-backend';
import {
  createS0WalkingSkeletonReplayFixture,
  runS0WalkingSkeleton,
  walkingSkeletonHtmlToken,
  walkingSkeletonOutputPath,
  walkingSkeletonRunId
} from './walking-skeleton';

const makeFixtureRepo = async (): Promise<string> => {
  const repoRoot = await mkdtemp(join(tmpdir(), 'docstube-s0-'));
  await mkdir(join(repoRoot, 'src'), { recursive: true });
  await writeFile(
    join(repoRoot, 'src', 'toolkit.ts'),
    ['export const toolkitName = "Fixture Toolkit";', 'export const renderToken = "DOCSTUBE";'].join('\n'),
    'utf8'
  );
  return repoRoot;
};

describe('S0 walking skeleton', () => {
  it('runs fixture repo through replay, deterministic check, state, and MDX HTML render', async () => {
    const repoRoot = await makeFixtureRepo();
    const backend = createLocalBackend(openDocstubeDatabase(':memory:'));
    const fixture = await createS0WalkingSkeletonReplayFixture(repoRoot);
    const adapter = createReplayAgentAdapter(fixture);

    const result = await runS0WalkingSkeleton({ repoRoot, backend, adapter });

    expect(result.checkResult).toEqual({ checkId: 'section-presence', status: 'passed' });
    expect(result.html).toContain(walkingSkeletonHtmlToken);
    expect(await readFile(join(repoRoot, walkingSkeletonOutputPath), 'utf8')).toContain(walkingSkeletonHtmlToken);

    const storedPage = await backend.getPage('overview');
    expect(storedPage?.status).toBe('passed');
    expect(storedPage?.findings).toEqual([]);

    const storedRun = await backend.getRun(walkingSkeletonRunId);
    expect(storedRun?.status).toBe('completed');

    await backend.close();
  });
});
