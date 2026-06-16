import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadDocstubeConfig, loadIa } from './config-yaml.ts';
import { writeSetupWizardFiles } from './setup-files.ts';

const fixturePath = (name: string): string => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

const withFixtureWorkspace = async (run: (dir: string) => Promise<void>) => {
  const dir = await mkdtemp(join(tmpdir(), 'docstube-setup-files-'));
  try {
    await mkdir(dir, { recursive: true });
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

describe('writeSetupWizardFiles', () => {
  it('writes config-family edits through validating, comment-preserving YAML documents', async () => {
    await withFixtureWorkspace(async (dir) => {
      const config = loadDocstubeConfig(await readFile(join(dir, 'docstube.yml'), 'utf8'));
      const ia = loadIa(await readFile(join(dir, 'ia.yml'), 'utf8'));
      const result = await writeSetupWizardFiles({
        workspaceDir: dir,
        config: {
          ...config,
          site: { ...config.site, name: 'Renamed Docs' },
          output: { ...config.output, dir: 'knowledge-base' },
          theme: { ...config.theme, tokens: { accent: '#2f6fed', radius: 6 }, credit: true }
        },
        ia: {
          ...ia,
          nav: [
            ...ia.nav,
            {
              id: 'operations',
              title: 'Operations',
              path: 'operations.mdx',
              brief: 'How to run the project in production.'
            }
          ]
        }
      });

      expect(result.config.site.name).toBe('Renamed Docs');
      expect(result.config.output.dir).toBe('knowledge-base');
      expect(result.ia.nav.at(-1)?.id).toBe('operations');
      expect(result.configText).toContain(
        '# docstube configuration. Edited by the setup wizard with comments preserved.'
      );
      expect(result.iaText).toContain('# Information architecture. Editable as a NavTree in the setup wizard.');

      const persistedConfig = loadDocstubeConfig(await readFile(join(dir, 'docstube.yml'), 'utf8'));
      const persistedIa = loadIa(await readFile(join(dir, 'ia.yml'), 'utf8'));
      expect(persistedConfig.site.name).toBe('Renamed Docs');
      expect(persistedIa.nav.at(-1)?.path).toBe('operations.mdx');
    });
  });
});
