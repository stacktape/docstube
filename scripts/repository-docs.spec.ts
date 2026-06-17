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

const expectMissing = async (path: string): Promise<void> => {
  await expect(access(join(rootDir, path))).rejects.toThrow(/ENOENT/u);
};

describe('repository product docs', () => {
  it('uses PRODUCT.md as the single product spec', async () => {
    await expectFile('PRODUCT.md');
    await Promise.all([expectMissing('PLAN.md'), expectMissing('ACCEPTANCE.md'), expectMissing('tasks.md')]);

    const docs = await Promise.all([
      readRepoFile('PRODUCT.md'),
      readRepoFile('AGENTS.md'),
      readRepoFile('README.md'),
      readRepoFile('scripts/dogfood/build-dogfood.ts')
    ]);

    for (const doc of docs) {
      expect(doc).not.toContain('PLAN.md');
      expect(doc).not.toContain('ACCEPTANCE.md');
      expect(doc).not.toContain('tasks.md');
    }

    expect(docs[0]).toContain('# docstube product');
    expect(docs[0]).toContain('## What docstube is');
    expect(docs[0]).toContain('## Hard boundaries');
  });

  it('keeps validation guidance executable instead of checklist based', async () => {
    const [readme, agents, packageRaw] = await Promise.all([
      readRepoFile('README.md'),
      readRepoFile('AGENTS.md'),
      readRepoFile('package.json')
    ]);
    const packageJson = JSON.parse(packageRaw) as { scripts?: Record<string, string> };

    for (const script of ['validate', 'dogfood:build', 'evals']) {
      expect(packageJson.scripts?.[script]).toBeTypeOf('string');
      expect(readme).toContain(`pnpm run ${script}`);
    }

    expect(agents).toContain('Acceptance evidence should be executable');
    expect(agents).toContain('Do not recreate the historical task queue');
  });
});
