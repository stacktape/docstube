import { execFile } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { env, execPath } from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { checkComponentProps, componentPropsCheckId } from '@docstube/verifiers';
import {
  builtInComponentNames,
  defaultThemeLayout,
  docstubeThemeRegistry,
  stableThemeComponentNames,
  themeComponentPropSchemas,
  themeLayouts
} from './theme';

const execFileAsync = promisify(execFile);

const fixtureRoot = fileURLToPath(new URL('../fixtures/generated-site/', import.meta.url));
const astroCli = fileURLToPath(new URL('../node_modules/astro/bin/astro.mjs', import.meta.url));

const cleanFixtureOutputs = async () => {
  await Promise.all([
    rm(join(fixtureRoot, '.astro'), { recursive: true, force: true }),
    rm(join(fixtureRoot, 'dist'), { recursive: true, force: true }),
    rm(join(fixtureRoot, 'node_modules'), { recursive: true, force: true })
  ]);
};

const sourceFiles = [
  'astro.config.mjs',
  'src/components/theme-components.tsx',
  'src/layouts/DocLayout.astro',
  'src/pages/index.mdx',
  'src/pages/guides/install.mdx'
] as const;

describe('docstube theme contract', () => {
  it('registers the built-in component contract and supported layouts', () => {
    expect(themeLayouts).toEqual(['single-tree', 'sectioned']);
    expect(defaultThemeLayout).toBe('single-tree');
    expect(docstubeThemeRegistry.components.map((component) => component.name)).toEqual(builtInComponentNames);

    const screenshot = docstubeThemeRegistry.components.find((component) => component.name === 'Screenshot');
    expect(screenshot?.status).toBe('reserved');
    expect(stableThemeComponentNames).not.toContain('Screenshot');
    expect(Object.keys(themeComponentPropSchemas)).not.toContain('screenshot-props');
  });

  it('validates component usage through shared registry metadata', () => {
    expect(
      checkComponentProps({
        registry: docstubeThemeRegistry,
        propSchemas: themeComponentPropSchemas,
        usages: [
          { name: 'Callout', props: { tone: 'warning', title: 'Careful' } },
          { name: 'Card', props: { title: 'Install', href: '/guides/install/' } },
          {
            name: 'Tabs',
            props: {
              tabs: [
                { label: 'pnpm', value: 'pnpm' },
                { label: 'npm', value: 'npm' }
              ],
              defaultValue: 'pnpm'
            }
          }
        ]
      })
    ).toEqual({ checkId: componentPropsCheckId, status: 'passed' });

    const failed = checkComponentProps({
      registry: docstubeThemeRegistry,
      propSchemas: themeComponentPropSchemas,
      usages: [
        { name: 'Callout', props: { tone: 'loud' } },
        { name: 'Screenshot', props: {} }
      ]
    });

    expect(failed.status).toBe('failed');
    expect(failed.status === 'failed' ? failed.findings.map((finding) => finding.message) : []).toEqual(
      expect.arrayContaining([
        expect.stringContaining('tone'),
        'Component is reserved and cannot be used yet: Screenshot'
      ])
    );
  });

  it('builds the self-contained generated Astro docs-site fixture', async () => {
    const packageJson = JSON.parse(await readFile(join(fixtureRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(packageJson.dependencies ?? {}).not.toHaveProperty('@docstube/theme');
    expect(packageJson.devDependencies ?? {}).not.toHaveProperty('@docstube/theme');

    const sources = await Promise.all(sourceFiles.map((path) => readFile(join(fixtureRoot, path), 'utf8')));
    expect(sources.join('\n')).not.toContain('@docstube/theme');

    await cleanFixtureOutputs();
    try {
      await execFileAsync(execPath, [astroCli, 'build'], {
        cwd: fixtureRoot,
        env: { ...env, CI: '1', NO_COLOR: '1' },
        maxBuffer: 10 * 1024 * 1024
      });

      const indexHtml = await readFile(join(fixtureRoot, 'dist', 'index.html'), 'utf8');
      const installHtml = await readFile(join(fixtureRoot, 'dist', 'guides', 'install', 'index.html'), 'utf8');
      expect(indexHtml).toContain('DOCSTUBE_THEME_FIXTURE_TOKEN');
      expect(indexHtml).toContain('data-component="Callout"');
      expect(installHtml).toContain('site-shell--sectioned');
    } finally {
      await cleanFixtureOutputs();
    }
  }, 120_000);
});
