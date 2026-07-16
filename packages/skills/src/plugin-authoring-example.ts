import type { PluginManifest } from '@docstube/contracts';

// Single source of truth for the worked example embedded in the plugin-authoring skill. The skill
// markdown interpolates these constants and the spec validates the manifest against
// pluginManifestSchema, so the documented example cannot drift from the real contract.

const exampleVerifierId = 'wordcount';

export const examplePluginManifest = {
  apiVersion: 1,
  name: 'docstube-plugin-wordcount',
  version: '0.1.0',
  description: 'Verifier: warns on pages over the word budget and fails the gate past the hard limit.',
  permissions: { network: false, exec: [], writableRoots: [] },
  capabilities: [{ kind: 'verifier', ids: [exampleVerifierId] }]
} satisfies PluginManifest;

const quote = (value: string): string => `'${value}'`;

// Renders manifest fields as the object-literal body of a definePlugin call.
export const renderManifestLiteral = (manifest: PluginManifest, indent = '  '): string => {
  const { permissions } = manifest;
  const capabilities = manifest.capabilities
    .map((capability) => `{ kind: ${quote(capability.kind)}, ids: [${capability.ids.map(quote).join(', ')}] }`)
    .join(', ');
  return [
    `${indent}apiVersion: ${manifest.apiVersion},`,
    `${indent}name: ${quote(manifest.name)},`,
    `${indent}version: ${quote(manifest.version)},`,
    ...(manifest.description === undefined ? [] : [`${indent}description: ${quote(manifest.description)},`]),
    `${indent}permissions: { network: ${permissions.network}, exec: [${permissions.exec.map(quote).join(', ')}], writableRoots: [${permissions.writableRoots.map(quote).join(', ')}] },`,
    `${indent}capabilities: [${capabilities}],`
  ].join('\n');
};

const verifierId = exampleVerifierId;

// Lines are plain strings (no outer template literal) so the example code can use backticks and
// ${} freely without escaping bugs.
export const examplePluginSource = [
  "import { definePlugin } from '@docstube/plugin-sdk';",
  'import type {',
  '  Finding,',
  '  PageArtifact,',
  '  VerifierContext,',
  '  VerifierDefinition,',
  '  VerifierRunResult',
  "} from '@docstube/plugin-sdk';",
  '',
  `const verifierId = ${quote(verifierId)};`,
  'const softLimit = 1500;',
  'const hardLimit = 3000;',
  '',
  '// Fenced code blocks are not prose; dedicated verifiers own them.',
  'const countWords = (mdx: string): number =>',
  '  mdx',
  "    .replace(/```[\\s\\S]*?```/gu, ' ')",
  '    .split(/\\s+/u)',
  '    .filter((word) => word.length > 0).length;',
  '',
  'const verify = async (_ctx: VerifierContext, pages: PageArtifact[]): Promise<VerifierRunResult> => {',
  '  const findings: Finding[] = [];',
  '  for (const artifact of pages) {',
  '    const words = countWords(artifact.mdx);',
  '    if (words <= softLimit) {',
  '      continue;',
  '    }',
  '    findings.push({',
  "      source: 'verifier',",
  '      check: verifierId,',
  "      severity: words > hardLimit ? 'error' : 'warning',",
  '      message: `page "${artifact.page.slug}" is ${words} words (soft limit ${softLimit}, hard limit ${hardLimit})`,',
  '      entity: { version: artifact.version, locale: artifact.locale, pageId: artifact.page.id },',
  '      file: artifact.mdxPath,',
  "      suggestion: 'Split the page or tighten its longest sections.',",
  '      data: { words, softLimit, hardLimit }',
  '    });',
  '  }',
  '  return {',
  '    verifier: verifierId,',
  `    plugin: ${quote(examplePluginManifest.name)},`,
  "    // 'fail' when any error-severity finding; warnings alone still pass.",
  "    status: findings.some((finding) => finding.severity === 'error') ? 'fail' : 'pass',",
  '    findings,',
  '    coveredEntityIds: pages.map((artifact) => artifact.page.id)',
  '  };',
  '};',
  '',
  'export const wordcountVerifier: VerifierDefinition = {',
  '  id: verifierId,',
  "  title: 'Page word budget',",
  "  description: 'Pages over 1500 words get a warning; pages over 3000 words fail the gate.',",
  "  scope: 'page',",
  "  localeScope: 'per-locale',",
  '  proves: false,',
  '  verify',
  '};',
  '',
  'export default definePlugin({',
  ...renderManifestLiteral(examplePluginManifest).split('\n'),
  '  register: (host) => {',
  '    host.verifier(wordcountVerifier);',
  '  }',
  '});'
].join('\n');

export const exampleSpecSource = [
  "import { describe, expect, it } from 'vitest';",
  "import type { PageArtifact, PageEntity, VerifierContext } from '@docstube/plugin-sdk';",
  "import plugin, { wordcountVerifier } from './plugin.ts';",
  '',
  '// In unit tests entity ids are opaque strings; only their prefix shape matters to docstube.',
  'const makePage = (slug: string): PageEntity => ({',
  "  id: 'pg_0123456789abcdefghjk',",
  "  kind: 'page',",
  '  slug,',
  '  title: slug,',
  '  preamble: [],',
  '  sections: [],',
  "  guarantee: 'scored',",
  '  provenance: { sources: [], seedContext: [], observedReads: [], verifications: [] }',
  '});',
  '',
  'const makeArtifact = (slug: string, mdx: string): PageArtifact => ({',
  '  page: makePage(slug),',
  '  mdx,',
  '  mdxPath: `docs/${slug}.mdx`,',
  "  locale: 'en',",
  "  version: 'latest'",
  '});',
  '',
  '// The verifier only reads pages, so unused context members can be inert stubs.',
  'const stubContext = (): VerifierContext => ({',
  "  repoRoot: '/repo',",
  "  config: {} as VerifierContext['config'],",
  "  codemap: { schemaVersion: 1, commit: 'a'.repeat(40), symbols: [] },",
  '  glossary: { schemaVersion: 1, terms: [] },',
  '  registry: { get: () => undefined, list: () => [] },',
  "  fs: { readFile: async () => '', exists: async () => false, writeFile: async () => {} },",
  "  exec: async () => ({ exitCode: 0, stdout: '', stderr: '' }),",
  '  logger: { info: () => {}, warn: () => {} }',
  '});',
  '',
  "const wordy = (count: number): string => Array.from({ length: count }, () => 'word').join(' ');",
  '',
  "describe('docstube-plugin-wordcount', () => {",
  "  it('exports a docstube plugin whose manifest declares what register() adds', () => {",
  `    expect(plugin.manifest.name).toBe(${quote(examplePluginManifest.name)});`,
  `    expect(plugin.manifest.capabilities).toEqual([{ kind: 'verifier', ids: [${quote(verifierId)}] }]);`,
  '  });',
  '',
  "  it('passes short pages and reports them as covered', async () => {",
  "    const artifact = makeArtifact('guide/install', 'A short page.\\n');",
  '    const result = await wordcountVerifier.verify(stubContext(), [artifact]);',
  "    expect(result.status).toBe('pass');",
  '    expect(result.findings).toEqual([]);',
  '    expect(result.coveredEntityIds).toEqual([artifact.page.id]);',
  '  });',
  '',
  "  it('warns over the soft limit and fails over the hard limit', async () => {",
  "    const warned = await wordcountVerifier.verify(stubContext(), [makeArtifact('long', wordy(1501))]);",
  "    expect(warned.status).toBe('pass');",
  "    expect(warned.findings[0]?.severity).toBe('warning');",
  '',
  "    const failed = await wordcountVerifier.verify(stubContext(), [makeArtifact('huge', wordy(3001))]);",
  "    expect(failed.status).toBe('fail');",
  "    expect(failed.findings[0]?.severity).toBe('error');",
  '  });',
  '});'
].join('\n');

export const examplePackageJsonSource = [
  '{',
  `  "name": "${examplePluginManifest.name}",`,
  `  "version": "${examplePluginManifest.version}",`,
  '  "description": "docstube verifier plugin: page word budget",',
  '  "keywords": ["docstube-plugin"],',
  '  "license": "MIT",',
  '  "type": "module",',
  '  "exports": "./dist/plugin.js",',
  '  "files": ["dist"],',
  '  "scripts": {',
  '    "build": "tsc -p tsconfig.json",',
  '    "test": "vitest run"',
  '  },',
  '  "dependencies": {',
  '    "@docstube/plugin-sdk": "^0.0.2"',
  '  },',
  '  "devDependencies": {',
  '    "typescript": "^6.0.3",',
  '    "vitest": "^4.1.8"',
  '  }',
  '}'
].join('\n');
