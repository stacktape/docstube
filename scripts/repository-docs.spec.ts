import { access, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const rootDir = fileURLToPath(new URL('../', import.meta.url));

const readRepoFile = (path: string): Promise<string> => readFile(join(rootDir, path), 'utf8');

const expectFile = async (path: string): Promise<void> => {
  const fileStat = await stat(join(rootDir, path));
  expect(fileStat.isFile()).toBe(true);
};

describe('repository acceptance docs', () => {
  it('uses ACCEPTANCE.md instead of the historical task queue', async () => {
    await expectFile('ACCEPTANCE.md');
    await expect(access(join(rootDir, 'tasks.md'))).rejects.toThrow(/ENOENT/u);

    const docs = await Promise.all([
      readRepoFile('ACCEPTANCE.md'),
      readRepoFile('AGENTS.md'),
      readRepoFile('PLAN.md'),
      readRepoFile('README.md'),
      readRepoFile('scripts/dogfood/build-dogfood.ts')
    ]);

    for (const doc of docs) {
      expect(doc).not.toContain('tasks.md');
    }

    expect(docs[0]).not.toContain('## Task 00');
    expect(docs[0]).not.toContain('## Task 24');
  });

  it('points acceptance readers at real executable evidence', async () => {
    const evidenceFiles = [
      'apps/cli/src/product-smoke.spec.ts',
      'apps/cli/src/cli-commands.spec.ts',
      'apps/cli/src/cli-help.spec.ts',
      'apps/cli/src/package-manifest.spec.ts',
      'apps/local-ui/src/product-app.spec.tsx',
      'apps/local-ui/src/setup-wizard.spec.tsx',
      'apps/local-ui/src/generation-dashboard.spec.tsx',
      'apps/local-ui/src/review-room.spec.tsx',
      'packages/core/src/project-generation.spec.ts',
      'packages/core/src/project-refresh.spec.ts',
      'packages/core/src/project-maintenance.spec.ts',
      'packages/core/src/page-orchestrator.spec.ts',
      'packages/contracts/src/config-schema.spec.ts',
      'packages/verifiers/src/verifiers.spec.ts',
      'packages/codemap/src/codemap.spec.ts',
      'packages/extractors/src/extractors.spec.ts',
      'packages/theme/src/theme.spec.ts',
      'packages/agent/src/agent.spec.ts',
      'apps/github-action/src/github-action.spec.ts',
      'scripts/dogfood/build-dogfood.spec.ts',
      'scripts/evals/run-evals.spec.ts'
    ];

    await Promise.all(evidenceFiles.map(expectFile));

    const acceptance = await readRepoFile('ACCEPTANCE.md');
    for (const file of evidenceFiles) {
      expect(acceptance).toContain(file);
    }
  });
});
