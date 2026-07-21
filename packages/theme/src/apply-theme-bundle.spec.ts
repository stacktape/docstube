import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyThemeBundle } from './apply-theme-bundle.ts';
import type { ThemeFilesManifest } from './apply-theme-bundle.ts';
import { ThemeError } from './theme-manifest.ts';
import type { ThemeBundle, ThemeManifest } from './theme-manifest.ts';

const manifestFor = (name: string): ThemeManifest => ({
  name,
  description: `${name} test theme`,
  dependencies: {},
  build: { globalStyleEntry: 'styles/global.css' },
  renderers: {},
  tokens: { accent: '#000000', fontBody: 'sans-serif', fontCode: 'monospace' }
});

const bundleFor = (name: string, files: ThemeBundle['files']): ThemeBundle => ({
  manifest: manifestFor(name),
  files: [
    { path: 'src/layouts/DocLayout.astro', content: `<!-- ${name} layout -->\n` },
    { path: 'src/styles/global.css', content: `/* ${name} */\n` },
    ...files
  ]
});

const setup = async (): Promise<{ siteRoot: string; manifestPath: string }> => {
  const repoRoot = await mkdtemp(join(tmpdir(), 'docstube-theme-apply-'));
  return { siteRoot: join(repoRoot, 'docs-site'), manifestPath: join(repoRoot, '.docstube', 'theme-files.json') };
};

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

describe('applyThemeBundle', () => {
  it('materializes a bundle and writes the ownership manifest (legacy overwrite-only without one)', async () => {
    const { siteRoot, manifestPath } = await setup();
    // Pre-existing file at an owned path with NO ownership manifest: legacy mode overwrites.
    await mkdir(join(siteRoot, 'src/layouts'), { recursive: true });
    await writeFile(join(siteRoot, 'src/layouts/DocLayout.astro'), 'stale legacy layout', 'utf8');

    const result = await applyThemeBundle({
      siteRoot,
      bundle: bundleFor('alpha', [{ path: 'src/components/widget.tsx', content: 'export const x = 1;\n' }]),
      previousManifestPath: manifestPath,
      themeVersion: '1.2.3',
      kernelConfigFiles: [{ path: 'package.json', content: '{"name":"site"}\n' }]
    });

    expect(result.conflicts).toEqual([]);
    expect(await readFile(join(siteRoot, 'src/layouts/DocLayout.astro'), 'utf8')).toBe('<!-- alpha layout -->\n');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as ThemeFilesManifest;
    expect(manifest.theme).toBe('alpha');
    expect(manifest.themeVersion).toBe('1.2.3');
    expect(manifest.files.map((file) => file.path)).toEqual([
      'package.json',
      'src/components/widget.tsx',
      'src/layouts/DocLayout.astro',
      'src/styles/global.css'
    ]);
  });

  it('switches themes cleanly: deletes unmodified previously-owned files absent from the new bundle', async () => {
    const { siteRoot, manifestPath } = await setup();
    await applyThemeBundle({
      siteRoot,
      bundle: bundleFor('alpha', [{ path: 'src/components/alpha-only.tsx', content: 'alpha\n' }]),
      previousManifestPath: manifestPath,
      themeVersion: '1.0.0'
    });
    // Content/kernel paths must never be touched by a theme switch.
    await mkdir(join(siteRoot, 'src/pages'), { recursive: true });
    await writeFile(join(siteRoot, 'src/pages/index.mdx'), '# hi\n', 'utf8');

    const result = await applyThemeBundle({
      siteRoot,
      bundle: bundleFor('beta', [{ path: 'src/components/beta-only.tsx', content: 'beta\n' }]),
      previousManifestPath: manifestPath,
      themeVersion: '1.0.0'
    });

    expect(result.deleted).toEqual(['src/components/alpha-only.tsx']);
    expect(await exists(join(siteRoot, 'src/components/alpha-only.tsx'))).toBe(false);
    expect(await readFile(join(siteRoot, 'src/components/beta-only.tsx'), 'utf8')).toBe('beta\n');
    expect(await readFile(join(siteRoot, 'src/layouts/DocLayout.astro'), 'utf8')).toBe('<!-- beta layout -->\n');
    expect(await readFile(join(siteRoot, 'src/pages/index.mdx'), 'utf8')).toBe('# hi\n');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as ThemeFilesManifest;
    expect(manifest.theme).toBe('beta');
    expect(manifest.files.some((file) => file.path === 'src/components/alpha-only.tsx')).toBe(false);
  });

  it('preserves user-modified files instead of deleting them and reports the conflict', async () => {
    const { siteRoot, manifestPath } = await setup();
    await applyThemeBundle({
      siteRoot,
      bundle: bundleFor('alpha', [{ path: 'src/components/alpha-only.tsx', content: 'alpha\n' }]),
      previousManifestPath: manifestPath,
      themeVersion: '1.0.0'
    });
    await writeFile(join(siteRoot, 'src/components/alpha-only.tsx'), 'my local edits\n', 'utf8');

    const result = await applyThemeBundle({
      siteRoot,
      bundle: bundleFor('beta', []),
      previousManifestPath: manifestPath,
      themeVersion: '1.0.0'
    });

    expect(result.conflicts).toEqual([{ path: 'src/components/alpha-only.tsx', kind: 'kept' }]);
    expect(await readFile(join(siteRoot, 'src/components/alpha-only.tsx'), 'utf8')).toBe('my local edits\n');
  });

  it('skips overwriting a user-modified owned file unless forced', async () => {
    const { siteRoot, manifestPath } = await setup();
    await applyThemeBundle({
      siteRoot,
      bundle: bundleFor('alpha', []),
      previousManifestPath: manifestPath,
      themeVersion: '1.0.0'
    });
    await writeFile(join(siteRoot, 'src/styles/global.css'), '/* customized */\n', 'utf8');

    const updated: ThemeBundle = {
      manifest: manifestFor('alpha'),
      files: [
        { path: 'src/layouts/DocLayout.astro', content: '<!-- alpha layout -->\n' },
        { path: 'src/styles/global.css', content: '/* alpha v2 */\n' }
      ]
    };
    const result = await applyThemeBundle({
      siteRoot,
      bundle: updated,
      previousManifestPath: manifestPath,
      themeVersion: '1.0.0'
    });
    expect(result.conflicts).toEqual([{ path: 'src/styles/global.css', kind: 'skipped' }]);
    expect(await readFile(join(siteRoot, 'src/styles/global.css'), 'utf8')).toBe('/* customized */\n');
    // The conflict persists across runs (the intended hash is recorded, never the user's).
    const again = await applyThemeBundle({
      siteRoot,
      bundle: updated,
      previousManifestPath: manifestPath,
      themeVersion: '1.0.0'
    });
    expect(again.conflicts).toEqual([{ path: 'src/styles/global.css', kind: 'skipped' }]);

    const forced = await applyThemeBundle({
      siteRoot,
      bundle: updated,
      previousManifestPath: manifestPath,
      themeVersion: '1.0.0',
      force: true
    });
    expect(forced.conflicts).toEqual([]);
    expect(await readFile(join(siteRoot, 'src/styles/global.css'), 'utf8')).toBe('/* alpha v2 */\n');
  });

  it('decodes base64 asset entries into public/', async () => {
    const { siteRoot, manifestPath } = await setup();
    const bytes = Buffer.from('font-bytes');
    await applyThemeBundle({
      siteRoot,
      bundle: bundleFor('alpha', [{ path: 'public/fonts/body.woff2', base64: bytes.toString('base64') }]),
      previousManifestPath: manifestPath,
      themeVersion: '1.0.0'
    });
    expect(await readFile(join(siteRoot, 'public/fonts/body.woff2'))).toEqual(bytes);
  });

  it('rejects traversal, absolute, and content/kernel-owned bundle paths', async () => {
    const { siteRoot, manifestPath } = await setup();
    const attempt = (files: ThemeBundle['files']) =>
      applyThemeBundle({
        siteRoot,
        bundle: bundleFor('evil', files),
        previousManifestPath: manifestPath,
        themeVersion: '1.0.0'
      });
    await expect(attempt([{ path: '../outside.txt', content: 'x' }])).rejects.toThrow(ThemeError);
    await expect(attempt([{ path: '/etc/passwd', content: 'x' }])).rejects.toThrow(ThemeError);
    await expect(attempt([{ path: 'src/pages/hijack.mdx', content: 'x' }])).rejects.toThrow(ThemeError);
    await expect(attempt([{ path: 'src/docstube/DocstubeClaims.astro', content: 'x' }])).rejects.toThrow(ThemeError);
    await expect(attempt([{ path: 'public/getting-started.md', content: 'x' }])).rejects.toThrow(ThemeError);
    await expect(attempt([{ path: 'package.json', content: '{}' }])).rejects.toThrow(ThemeError);
    await expect(
      attempt([
        { path: 'src/Components/x.ts', content: 'x' },
        { path: 'src/components/X.ts', content: 'x' }
      ])
    ).rejects.toThrow(/case-colliding/u);
  });

  it('rejects a bundle missing the mandatory DocLayout.astro', async () => {
    const { siteRoot, manifestPath } = await setup();
    await expect(
      applyThemeBundle({
        siteRoot,
        bundle: { manifest: manifestFor('broken'), files: [{ path: 'src/styles/global.css', content: 'x' }] },
        previousManifestPath: manifestPath,
        themeVersion: '1.0.0'
      })
    ).rejects.toThrow(/DocLayout\.astro/u);
  });
});
