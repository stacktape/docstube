import { describe, expect, it } from 'vitest';
import { docstubeConfigSchema } from '@docstube/contracts';
import type { WizardIaNode, WizardState } from './wizard-state.ts';
import {
  applyIaOp,
  buildConfigInput,
  buildConfigUpdates,
  buildIa,
  initialWizardState,
  mintUid,
  stepIssues,
  toIaTree,
  wizardReducer
} from './wizard-state.ts';

const node = (title: string, slug: string, children: WizardIaNode[] = []): WizardIaNode => ({
  uid: mintUid(),
  title,
  slug,
  brief: '',
  children
});

describe('applyIaOp', () => {
  it('moves, indents, and outdents nodes anywhere in the tree', () => {
    const a = node('A', 'a');
    const b = node('B', 'b');
    const c = node('C', 'c');
    const tree = [a, b, c];

    const moved = applyIaOp(tree, { kind: 'move', uid: c.uid, direction: 'up' });
    expect(moved.map((n) => n.slug)).toEqual(['a', 'c', 'b']);

    const indented = applyIaOp(tree, { kind: 'indent', uid: b.uid });
    expect(indented.map((n) => n.slug)).toEqual(['a', 'c']);
    expect(indented[0]?.children.map((n) => n.slug)).toEqual(['b']);

    const outdented = applyIaOp(indented, { kind: 'outdent', uid: b.uid });
    expect(outdented.map((n) => n.slug)).toEqual(['a', 'b', 'c']);
  });

  it('updates, adds, and removes nested nodes', () => {
    const child = node('Child', 'child');
    const parent = node('Parent', 'parent', [child]);
    const updated = applyIaOp([parent], { kind: 'update', uid: child.uid, patch: { title: 'Renamed', brief: 'x' } });
    expect(updated[0]?.children[0]?.title).toBe('Renamed');

    const withSibling = applyIaOp([parent], { kind: 'add-sibling', uid: child.uid });
    expect(withSibling[0]?.children).toHaveLength(2);

    const removed = applyIaOp([parent], { kind: 'remove', uid: child.uid });
    expect(removed[0]?.children).toHaveLength(0);
  });
});

describe('toIaTree', () => {
  it('omits empty briefs, unset depths, and empty children', () => {
    const leaf = node('Install', 'install');
    leaf.brief = 'How to install.';
    leaf.depth = 'standard';
    const group = node('Guides', 'guides', [leaf]);
    expect(toIaTree([group])).toEqual([
      {
        title: 'Guides',
        slug: 'guides',
        children: [{ title: 'Install', slug: 'install', brief: 'How to install.', depth: 'standard' }]
      }
    ]);
  });
});

const filledState = (): WizardState => {
  let state = initialWizardState();
  state = wizardReducer(state, { type: 'hydrate', family: undefined, detection: undefined });
  state = wizardReducer(state, { type: 'set-doc-type', docType: 'external-library' });
  state = wizardReducer(state, {
    type: 'set-personas',
    personas: [{ id: 'app-developer', description: 'Integrates the library.' }]
  });
  state = wizardReducer(state, { type: 'ia-edit', op: { kind: 'add-child', uid: undefined } });
  state = wizardReducer(state, { type: 'set-site-field', field: 'siteTitle', value: 'Acme Docs' });
  return state;
};

describe('validation and reducer', () => {
  it('gates the essential steps and clears as fields fill in', () => {
    const empty = wizardReducer(initialWizardState(), { type: 'hydrate', family: undefined, detection: undefined });
    expect(stepIssues(empty, 'doc-type')).toHaveLength(1);
    expect(stepIssues(empty, 'personas')).toHaveLength(1);
    expect(stepIssues(empty, 'ia')).toHaveLength(1);
    expect(stepIssues(empty, 'metadata')).toHaveLength(1);
    const filled = filledState();
    for (const stepId of ['doc-type', 'personas', 'ia', 'metadata', 'versions', 'sources'] as const) {
      expect(stepIssues(filled, stepId)).toEqual([]);
    }
  });

  it('flips the IA choice to custom on any edit', () => {
    let state = filledState();
    state = {
      ...state,
      iaChoice: 'task-oriented'
    };
    const root = state.iaTree[0] as WizardIaNode;
    state = wizardReducer(state, { type: 'ia-edit', op: { kind: 'update', uid: root.uid, patch: { title: 'Intro' } } });
    expect(state.iaChoice).toBe('custom');
  });

  it('builds an intent-only scaffold config', () => {
    const config = buildConfigInput(filledState());
    expect(config).toMatchObject({
      schemaVersion: 1,
      docType: 'external-library',
      personas: [{ id: 'app-developer', description: 'Integrates the library.' }],
      versions: { current: 'latest', frozen: [] },
      locales: { source: 'en', targets: [] },
      site: { title: 'Acme Docs' }
    });
    // Untouched optional groups stay out of the scaffolded file — except the theme name, which is
    // always explicit so a later default change never restyles an existing repo.
    expect(config).not.toHaveProperty('sources');
    expect(config.theme).toEqual({ name: 'basic' });
    expect(buildIa(filledState()).schemaVersion).toBe(1);
  });

  it('scaffolds logo and favicon under site — the strict theme schema is tokens-only', () => {
    let state = filledState();
    state = wizardReducer(state, { type: 'set-site-field', field: 'logo', value: 'assets/logo.svg' });
    state = wizardReducer(state, { type: 'set-site-field', field: 'favicon', value: 'assets/favicon.ico' });
    const config = buildConfigInput(state);
    // No tokens were set, so the theme group carries only the explicit name — logo/favicon are
    // site metadata.
    expect(config.theme).toEqual({ name: 'basic' });
    expect(config.site).toMatchObject({ logo: 'assets/logo.svg', favicon: 'assets/favicon.ico' });
    // The scaffolded config must survive the strict schema, or `docstube wizard` writes a file
    // every later command rejects.
    const parsed = docstubeConfigSchema.safeParse(config);
    expect(parsed.error?.message ?? '').toBe('');
    expect(parsed.success).toBe(true);
  });
});

describe('buildConfigUpdates', () => {
  it('diffs against the hydration baseline and emits only what changed', () => {
    const config = {
      schemaVersion: 1 as const,
      docType: 'external-library' as const,
      projectContext: 'A toolkit.',
      personas: [{ id: 'app-developer', description: 'Integrates the library.' }],
      sources: { openapi: [], asyncapi: [], imports: [] },
      agents: {
        transport: 'claude-cli' as const,
        roles: {},
        budgets: { maxRunUsd: 20, maxTurnsPerTask: 24, maxToolCallsPerTask: 64, maxPlanUsagePercent: 80 }
      },
      versions: { current: 'latest', frozen: [] },
      locales: { source: 'en', targets: [] },
      theme: { name: 'basic', tokens: {} },
      site: { title: 'Acme Docs', description: '', layout: 'single-tree' as const, footerCredit: true },
      components: ['Callout'],
      plugins: [],
      coverage: 'auto' as const,
      outDir: 'docs-site',
      telemetry: { enabled: true }
    };
    const ia = { schemaVersion: 1 as const, tree: [{ title: 'Install', slug: 'install' }] };
    let state = wizardReducer(initialWizardState(), { type: 'hydrate', family: { config, ia }, detection: undefined });
    expect(state.mode).toBe('edit');
    expect(buildConfigUpdates(state)).toEqual([]);

    state = wizardReducer(state, { type: 'set-site-field', field: 'siteTitle', value: 'Acme Kit Docs' });
    state = wizardReducer(state, { type: 'set-theme-token', name: 'accent', value: '#123456' });
    const updates = buildConfigUpdates(state);
    expect(updates).toEqual([
      { path: ['theme', 'tokens'], value: { accent: '#123456' } },
      { path: ['site', 'title'], value: 'Acme Kit Docs' }
    ]);
  });
});
