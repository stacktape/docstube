import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { initializeProjectGeneration } from './project-generation.ts';

const fixturePath = (name: string): string => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

const withWorkspace = async (run: (dir: string) => Promise<void>) => {
  const dir = await mkdtemp(join(tmpdir(), 'docstube-project-generation-'));
  try {
    await Promise.all([
      copyFile(fixturePath('docstube.yml'), join(dir, 'docstube.yml')),
      copyFile(fixturePath('ia.yml'), join(dir, 'ia.yml')),
      copyFile(fixturePath('glossary.yaml'), join(dir, 'glossary.yaml'))
    ]);
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

describe('initializeProjectGeneration', () => {
  it('initializes and resumes project generation state from the config family', async () => {
    await withWorkspace(async (workspaceDir) => {
      const first = await initializeProjectGeneration({ workspaceDir });
      const second = await initializeProjectGeneration({ workspaceDir });

      expect(first).toMatchObject({
        pagesCount: 2,
        resumed: false
      });
      expect(second).toEqual({
        pagesCount: 2,
        resumed: true,
        runId: first.runId
      });
    });
  });
});
