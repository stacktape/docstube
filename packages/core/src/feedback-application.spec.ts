import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadDocstubeConfig, loadGlossary } from './config-yaml.ts';
import { openDocstubeDatabase } from './db-migrations.ts';
import { applyFeedbackToProjectFiles } from './feedback-application.ts';
import { createLocalBackend } from './local-backend.ts';
import type { StateBackend } from './state-backend.ts';

const timestamp = '2026-06-16T00:00:00.000Z';

const fixturePath = (name: string): string => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

const withFixtureWorkspace = async (run: (input: { backend: StateBackend; dir: string }) => Promise<void>) => {
  const dir = await mkdtemp(join(tmpdir(), 'docstube-feedback-application-'));
  const backend = createLocalBackend(openDocstubeDatabase(':memory:'));
  try {
    await Promise.all([
      copyFile(fixturePath('docstube.yml'), join(dir, 'docstube.yml')),
      copyFile(fixturePath('ia.yml'), join(dir, 'ia.yml')),
      copyFile(fixturePath('glossary.yaml'), join(dir, 'glossary.yaml'))
    ]);
    await run({ backend, dir });
  } finally {
    await backend.close();
    await rm(dir, { recursive: true, force: true });
  }
};

const feedbackRecord = (id: string, message: string) => ({
  id,
  createdAt: timestamp,
  scope: 'page' as const,
  message,
  pageId: 'overview',
  category: 'instruction' as const,
  status: 'open' as const
});

describe('applyFeedbackToProjectFiles', () => {
  it('writes instruction and criteria feedback into committed .docstube files', async () => {
    await withFixtureWorkspace(async ({ backend, dir }) => {
      const instructions = await applyFeedbackToProjectFiles({
        backend,
        workspaceDir: dir,
        target: 'instructions',
        record: feedbackRecord('feedback-instructions', 'Keep this wording for overview pages.')
      });
      const criteria = await applyFeedbackToProjectFiles({
        backend,
        workspaceDir: dir,
        target: 'criteria',
        record: feedbackRecord('feedback-criteria', 'The docs must prove the quickstart works.')
      });

      expect(instructions.written).toEqual(['.docstube/instructions/feedback.md']);
      expect(criteria.written).toEqual(['.docstube/criteria/feedback.md']);
      await expect(readFile(join(dir, '.docstube', 'instructions', 'feedback.md'), 'utf8')).resolves.toContain(
        'Keep this wording'
      );
      await expect(readFile(join(dir, '.docstube', 'criteria', 'feedback.md'), 'utf8')).resolves.toContain(
        'quickstart works'
      );
      expect(await backend.listFeedback()).toHaveLength(2);
    });
  });

  it('writes config and glossary feedback as YAML comments while preserving valid files', async () => {
    await withFixtureWorkspace(async ({ backend, dir }) => {
      await applyFeedbackToProjectFiles({
        backend,
        workspaceDir: dir,
        target: 'config',
        record: feedbackRecord('feedback-config', 'Use a more direct site description.')
      });
      await applyFeedbackToProjectFiles({
        backend,
        workspaceDir: dir,
        target: 'glossary',
        record: feedbackRecord('feedback-glossary', 'Add a glossary term for runtime telemetry.')
      });

      const configText = await readFile(join(dir, 'docstube.yml'), 'utf8');
      const glossaryText = await readFile(join(dir, 'glossary.yaml'), 'utf8');
      expect(configText).toContain('docstube feedback feedback-config');
      expect(glossaryText).toContain('docstube feedback feedback-glossary');
      expect(loadDocstubeConfig(configText).site.name).toBe('Acme Toolkit');
      expect(loadGlossary(glossaryText).terms.map((term) => term.id)).toEqual(['codemap', 'persona']);
    });
  });
});
