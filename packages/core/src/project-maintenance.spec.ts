import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AdapterProcessRunner } from '@docstube/agent';
import type { Finding } from '@docstube/contracts';
import { describe, expect, it } from 'vitest';
import { openDocstubeDatabase } from './db-migrations.ts';
import { readManifestFile, updateManifest, writeManifestFile } from './incremental-engine.ts';
import { createLocalBackend } from './local-backend.ts';
import { doctorProject } from './project-doctor.ts';
import { createDeterministicProjectGenerationAdapters, generateProjectDocumentation } from './project-generation.ts';
import { refineProjectDocumentation } from './project-refinement.ts';
import { getProjectStatus } from './project-status.ts';

const fixturePath = (name: string): string => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

const withWorkspace = async (run: (dir: string) => Promise<void>) => {
  const dir = await mkdtemp(join(tmpdir(), 'docstube-project-maintenance-'));
  try {
    await Promise.all([
      copyFile(fixturePath('docstube.yml'), join(dir, 'docstube.yml')),
      copyFile(fixturePath('ia.yml'), join(dir, 'ia.yml')),
      copyFile(fixturePath('glossary.yaml'), join(dir, 'glossary.yaml'))
    ]);
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src', 'toolkit.ts'), 'export const toolkit = "v1";\n', 'utf8');
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

const majorFinding: Finding = {
  code: 'mdx-compile',
  severity: 'major',
  origin: 'verifier',
  message: 'Broken MDX',
  pageId: 'overview'
};

const successfulToolRunner: AdapterProcessRunner = async (request) => ({
  stdout: `${request.command} 1.2.3\n`,
  stderr: '',
  exitCode: 0,
  timedOut: false
});

describe('project maintenance workflows', () => {
  it('reports status from manifest, local page state, stale seeds, and refinement candidates', async () => {
    await withWorkspace(async (workspaceDir) => {
      await generateProjectDocumentation({
        workspaceDir,
        adapterFactory: createDeterministicProjectGenerationAdapters
      });

      const clean = await getProjectStatus({ workspaceDir });
      expect(clean.config).toMatchObject({ found: true, valid: true });
      expect(clean.manifest).toMatchObject({ pageCount: 2, statusCounts: { passed: 2 } });
      expect(clean.pageState).toMatchObject({ found: true, pageCount: 2 });
      expect(clean.staleDecisions).toEqual([]);

      await writeFile(join(workspaceDir, 'src', 'toolkit.ts'), 'export const toolkit = "v2";\n', 'utf8');
      const stale = await getProjectStatus({ workspaceDir });
      expect(stale.staleDecisions.map((decision) => decision.pageId).toSorted()).toEqual(['overview']);
    });
  });

  it('ranks the worst persisted page first and records deterministic refinement planning', async () => {
    await withWorkspace(async (workspaceDir) => {
      const generation = await generateProjectDocumentation({
        workspaceDir,
        adapterFactory: createDeterministicProjectGenerationAdapters
      });
      const manifestPath = join(workspaceDir, '.docstube', 'manifest.yml');
      const manifest = await readManifestFile(manifestPath);
      const flaggedManifest = updateManifest({
        existing: manifest,
        generatedWith: manifest.generatedWith,
        pages: [
          {
            ...manifest.pages.find((page) => page.id === 'overview')!,
            status: 'flagged'
          }
        ]
      });
      await writeManifestFile(manifestPath, flaggedManifest);

      const backend = createLocalBackend(openDocstubeDatabase(join(workspaceDir, '.docstube', 'db.sqlite')));
      try {
        await backend.upsertPage({
          id: 'overview',
          runId: generation.runId,
          title: 'Overview',
          slug: 'docs/overview.mdx',
          status: 'flagged',
          approved: false,
          findings: [majorFinding],
          updatedAt: '2026-06-16T00:00:00.000Z'
        });
      } finally {
        await backend.close();
      }

      const result = await refineProjectDocumentation({ workspaceDir, failedOnly: true, maxRounds: 1 });

      expect(result.candidates[0]).toMatchObject({ id: 'overview', score: 60 });
      expect(result.plannedPages).toHaveLength(1);
      expect(result.plannedPages[0]?.id).toBe('overview');

      const stored = createLocalBackend(openDocstubeDatabase(join(workspaceDir, '.docstube', 'db.sqlite')));
      try {
        const page = await stored.getPage('overview');
        expect(page?.findings.map((finding) => finding.code)).toEqual(['mdx-compile', 'refinement-planned']);
      } finally {
        await stored.close();
      }
    });
  });

  it('checks runtime, config, optional tools, and configured agent CLI availability without live agents', async () => {
    await withWorkspace(async (workspaceDir) => {
      const result = await doctorProject({
        workspaceDir,
        nodeVersion: 'v24.12.0',
        runProcess: successfulToolRunner
      });

      expect(result.ok).toBe(true);
      expect(result.checks.map((check) => check.id)).toEqual([
        'node-version',
        'platform',
        'config',
        'manifest',
        'local-state',
        'optional-tool-pyright',
        'agent-codex',
        'agent-claude'
      ]);
      expect(result.checks.find((check) => check.id === 'agent-codex')).toMatchObject({ status: 'passed' });
    });
  });

  it('still reports runtime and optional tool checks when config is missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'docstube-doctor-missing-config-'));
    try {
      const result = await doctorProject({
        workspaceDir: dir,
        nodeVersion: 'v24.12.0',
        runProcess: successfulToolRunner
      });

      expect(result.ok).toBe(false);
      expect(result.checks.map((check) => check.id)).toEqual([
        'node-version',
        'platform',
        'config',
        'optional-tool-pyright'
      ]);
      expect(result.checks.find((check) => check.id === 'config')).toMatchObject({ status: 'failed' });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
