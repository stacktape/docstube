import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { docTypeSchema, personaSchema } from '@docstube/contracts';
import { detectProject } from './detect-project.ts';
import { suggestPersonas } from './personas.ts';

const createdDirs: string[] = [];

const makeRepo = async (files: Record<string, string>): Promise<string> => {
  const repoRoot = await mkdtemp(join(tmpdir(), 'docstube-detect-'));
  createdDirs.push(repoRoot);
  for (const [relPath, content] of Object.entries(files)) {
    const absPath = join(repoRoot, relPath);
    await mkdir(join(absPath, '..'), { recursive: true });
    await writeFile(absPath, content, 'utf8');
  }
  return repoRoot;
};

afterEach(async () => {
  await Promise.all(createdDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('detectProject', () => {
  it('detects a TypeScript library repo with context from the package description', async () => {
    const repoRoot = await makeRepo({
      'package.json': JSON.stringify({
        name: '@acme/data-toolkit',
        description: 'A small toolkit for wrangling tabular data.',
        exports: { '.': './dist/toolkit.js' },
        devDependencies: { typescript: '^5.9.0' }
      }),
      'tsconfig.json': '{}',
      'README.md': '# Something Else\n\nREADME paragraph that must NOT win over the description.\n'
    });
    const detection = await detectProject(repoRoot);
    expect(detection.docType).toBe('external-library');
    expect(detection.languages).toContain('typescript');
    expect(detection.siteTitle).toBe('Data Toolkit');
    expect(detection.projectContext).toBe('A small toolkit for wrangling tabular data.');
  });

  it('detects a private monorepo as internal', async () => {
    const repoRoot = await makeRepo({
      'package.json': JSON.stringify({ name: 'megacorp-platform', private: true, main: './src/main.js' }),
      'pnpm-workspace.yaml': 'packages:\n  - packages/*\n'
    });
    const detection = await detectProject(repoRoot);
    expect(detection.docType).toBe('internal');
    expect(detection.monorepo).toBe(true);
  });

  it('detects workspaces field as monorepo signal', async () => {
    const repoRoot = await makeRepo({
      'package.json': JSON.stringify({ name: 'ws-root', workspaces: ['packages/*'] })
    });
    const detection = await detectProject(repoRoot);
    expect(detection.monorepo).toBe(true);
  });

  it('detects an app-framework repo without library exports as external-product', async () => {
    const repoRoot = await makeRepo({
      'package.json': JSON.stringify({
        name: 'acme-dashboard',
        dependencies: { next: '^16.0.0', react: '^19.0.0' }
      })
    });
    const detection = await detectProject(repoRoot);
    expect(detection.docType).toBe('external-product');
    expect(detection.frameworks).toEqual(expect.arrayContaining(['react', 'next']));
  });

  it('leaves everything blank on an ambiguous empty-ish repo instead of guessing', async () => {
    const repoRoot = await makeRepo({ 'notes.txt': 'nothing to see here' });
    const detection = await detectProject(repoRoot);
    expect(detection.docType).toBeUndefined();
    expect(detection.siteTitle).toBeUndefined();
    expect(detection.projectContext).toBeUndefined();
    expect(detection.packageManager).toBeUndefined();
    expect(detection.languages).toEqual([]);
    expect(detection.openapiSpecs).toEqual([]);
    expect(detection.asyncapiSpecs).toEqual([]);
    expect(detection.frameworks).toEqual([]);
    expect(detection.monorepo).toBe(false);
  });

  it('leaves docType blank when package.json has no decisive signal', async () => {
    const repoRoot = await makeRepo({
      'package.json': JSON.stringify({ name: 'mystery', dependencies: { react: '^19.0.0' } })
    });
    const detection = await detectProject(repoRoot);
    expect(detection.docType).toBeUndefined();
    expect(detection.frameworks).toEqual(['react']);
  });

  it('extracts title and context from the README when package.json is absent', async () => {
    const longTail = 'x'.repeat(400);
    const repoRoot = await makeRepo({
      'README.md': `# Rocket Boots\n\n![build](https://example.com/badge.svg)\n\nRocket Boots makes deploys fast.\nIt straps rockets to your CI. ${longTail}\n\n## Install\n`
    });
    const detection = await detectProject(repoRoot);
    expect(detection.siteTitle).toBe('Rocket Boots');
    expect(detection.projectContext).toMatch(/^Rocket Boots makes deploys fast\. It straps rockets to your CI\./);
    expect(detection.projectContext!.length).toBeLessThanOrEqual(300);
  });

  it('finds OpenAPI and AsyncAPI specs by filename and by content, within two directory levels', async () => {
    const repoRoot = await makeRepo({
      'openapi.yaml': 'openapi: 3.1.0\ninfo:\n  title: root spec\n',
      'specs/swagger-v2.json': '{"swagger": "2.0", "info": {"title": "legacy"}}',
      'specs/api.yaml': 'openapi: 3.1.0\ninfo:\n  title: sniffed by content\n',
      'specs/events.yml': 'asyncapi: 2.6.0\ninfo:\n  title: events\n',
      'specs/values.yaml': 'replicas: 3\nimage: nginx\n',
      'a/b/c/too-deep.yaml': 'openapi: 3.1.0\n',
      'node_modules/dep/openapi.yaml': 'openapi: 3.1.0\n'
    });
    const detection = await detectProject(repoRoot);
    expect(detection.openapiSpecs).toEqual(['openapi.yaml', 'specs/api.yaml', 'specs/swagger-v2.json']);
    expect(detection.asyncapiSpecs).toEqual(['specs/events.yml']);
  });

  it('detects the package manager from a lockfile', async () => {
    const repoRoot = await makeRepo({
      'package.json': JSON.stringify({ name: 'locked' }),
      'pnpm-lock.yaml': 'lockfileVersion: 9\n'
    });
    const detection = await detectProject(repoRoot);
    expect(detection.packageManager).toBe('pnpm');
  });

  it('lets the packageManager field win over lockfiles', async () => {
    const repoRoot = await makeRepo({
      'package.json': JSON.stringify({ name: 'field-wins', packageManager: 'yarn@4.5.0' }),
      'pnpm-lock.yaml': 'lockfileVersion: 9\n'
    });
    const detection = await detectProject(repoRoot);
    expect(detection.packageManager).toBe('yarn');
  });

  it('leaves the package manager blank when lockfiles conflict', async () => {
    const repoRoot = await makeRepo({
      'package.json': JSON.stringify({ name: 'conflicted' }),
      'pnpm-lock.yaml': 'lockfileVersion: 9\n',
      'yarn.lock': '# yarn lockfile v1\n'
    });
    const detection = await detectProject(repoRoot);
    expect(detection.packageManager).toBeUndefined();
  });

  it('detects python and java from their manifests', async () => {
    const repoRoot = await makeRepo({
      'pyproject.toml': '[project]\nname = "poly"\n',
      'pom.xml': '<project></project>'
    });
    const detection = await detectProject(repoRoot);
    expect(detection.languages).toEqual(['python', 'java']);
  });

  it('completes well under 1s on a repo with ~200 nested files', async () => {
    const files: Record<string, string> = {
      'package.json': JSON.stringify({ name: 'big-repo', private: true }),
      'openapi.yml': 'openapi: 3.0.0\n'
    };
    for (let dir = 0; dir < 10; dir += 1) {
      for (let file = 0; file < 10; file += 1) {
        files[`pkg-${dir}/deep/config-${file}.yaml`] = `key-${file}: value\nnested:\n  further: true\n`;
        files[`pkg-${dir}/data-${file}.json`] = JSON.stringify({ index: file });
      }
    }
    const repoRoot = await makeRepo(files);
    const startedAt = performance.now();
    const detection = await detectProject(repoRoot);
    const elapsedMs = performance.now() - startedAt;
    expect(detection.docType).toBe('internal');
    expect(detection.openapiSpecs).toEqual(['openapi.yml']);
    expect(elapsedMs).toBeLessThan(1000);
  });
});

describe('suggestPersonas', () => {
  it('returns schema-valid personas for every doc type', () => {
    for (const docType of docTypeSchema.options) {
      const personas = suggestPersonas(docType);
      expect(personas.length).toBeGreaterThanOrEqual(2);
      for (const persona of personas) {
        expect(() => personaSchema.parse(persona)).not.toThrow();
      }
    }
  });

  it('returns the documented catalog per doc type', () => {
    expect(suggestPersonas('internal').map((p) => p.id)).toEqual(['backend-engineer', 'new-team-member']);
    expect(suggestPersonas('external-library').map((p) => p.id)).toEqual(['app-developer', 'library-evaluator']);
    expect(suggestPersonas('external-product').map((p) => p.id)).toEqual(['end-user', 'administrator']);
  });
});
