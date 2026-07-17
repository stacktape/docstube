import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { builtinThemes } from '../theme-manifest.ts';
import type { ThemeBundle } from '../theme-manifest.ts';

// Same pattern as packages/lang-python/src/python-inspector-source.spec.ts: the checked-in
// bundle.generated.ts must stay identical to the authored source directory. Regenerate with
// `node scripts/build-theme-bundles.ts` whenever a theme's site/ or assets/ files change.

const themesDir = dirname(fileURLToPath(import.meta.url));

const walkFiles = async (root: string, relative = ''): Promise<string[]> => {
  let entries;
  try {
    entries = await readdir(join(root, relative), { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = relative === '' ? entry.name : `${relative}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(root, entryPath)));
    } else {
      files.push(entryPath);
    }
  }
  return files;
};

const expectedBundleFiles = async (themeDir: string): Promise<Map<string, string>> => {
  const expected = new Map<string, string>();
  for (const relative of await walkFiles(join(themeDir, 'site'))) {
    const raw = await readFile(join(themeDir, 'site', relative), 'utf8');
    expected.set(`src/${relative}`, raw.replace(/\r\n/g, '\n'));
  }
  for (const relative of await walkFiles(join(themeDir, 'assets'))) {
    const raw = await readFile(join(themeDir, 'assets', relative));
    expected.set(`public/${relative}`, raw.toString('base64'));
  }
  return expected;
};

const bundleFileValue = (file: ThemeBundle['files'][number]): string =>
  'content' in file ? file.content : file.base64;

const byPath = (left: string, right: string): number => left.localeCompare(right);

describe('theme bundle sync', () => {
  it('covers every authored theme directory with a registry entry', async () => {
    const authored = (await readdir(themesDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .toSorted();
    expect(Object.keys(builtinThemes).toSorted()).toEqual(authored);
  });

  it('keeps every bundle.generated.ts byte-identical to its source directory', async () => {
    for (const [name, loadTheme] of Object.entries(builtinThemes)) {
      const bundle = await loadTheme();
      expect(bundle.manifest.name).toBe(name);
      const expected = await expectedBundleFiles(join(themesDir, name));
      const actualPaths = bundle.files.map((file) => file.path);
      expect(actualPaths, `theme "${name}" bundle file set`).toEqual([...expected.keys()].toSorted(byPath));
      // Deterministic ordering: the generator sorts by path.
      expect(actualPaths).toEqual([...actualPaths].toSorted(byPath));
      for (const file of bundle.files) {
        expect(bundleFileValue(file), `theme "${name}" file ${file.path}`).toBe(expected.get(file.path));
      }
    }
  });

  it('declares build hooks that exist in the bundle', async () => {
    for (const loadTheme of Object.values(builtinThemes)) {
      const bundle = await loadTheme();
      const paths = new Set(bundle.files.map((file) => file.path));
      expect(paths.has(`src/${bundle.manifest.build.globalStyleEntry}`)).toBe(true);
      const integrationsModule = bundle.manifest.build.integrationsModule;
      expect(integrationsModule === undefined || paths.has(`src/${integrationsModule}`)).toBe(true);
      // The kernel references this path from every generated page's frontmatter.
      expect(paths.has('src/layouts/DocLayout.astro')).toBe(true);
      for (const target of Object.values(bundle.manifest.renderers)) {
        const modulePath = target.includes('#') ? target.slice(0, target.indexOf('#')) : target;
        expect(paths.has(`src/${modulePath}`), `renderer module ${modulePath}`).toBe(true);
      }
    }
  });
});
