// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { docstubeConfigSchema } from '@docstube/contracts';
import type { DocstubeConfig, Ia } from '@docstube/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { SetupWizard } from './setup-wizard.tsx';
import type { SetupWizardSaveInput } from './setup-wizard.tsx';

const config: DocstubeConfig = {
  version: 1,
  site: { name: 'Fixture Docs', locale: 'en' },
  docsType: 'library',
  output: { dir: 'docs', layout: 'single-tree' },
  personas: [{ id: 'developer', title: 'Developer' }],
  agents: { writer: { adapter: 'codex', model: 'fixture' } },
  ia: 'ia.yml',
  glossary: 'glossary.yaml',
  theme: { credit: true, tokens: { accent: '#2563eb', surface: '#f8fafc', radius: 8 } }
};

const ia: Ia = {
  version: 1,
  layout: 'single-tree',
  nav: [
    {
      id: 'overview',
      title: 'Overview',
      path: 'overview.mdx',
      brief: 'Project overview.'
    }
  ]
};

const renderAtWidth = (width: number, onSave: (input: SetupWizardSaveInput) => void = () => {}) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  render(
    <SetupWizard initialConfig={config} initialIa={ia} initialThemeTokens={config.theme?.tokens} onSave={onSave} />
  );
  const shell = screen.getByTestId('setup-wizard-shell');
  Object.defineProperty(shell, 'clientWidth', { configurable: true, value: width });
  Object.defineProperty(shell, 'scrollWidth', { configurable: true, value: width });
  return shell;
};

const expectAnchor = (testId: string) => {
  const element = screen.getByTestId(testId);
  const text = element instanceof HTMLInputElement ? element.value : element.textContent;
  expect(text?.trim().length).toBeGreaterThan(0);
  return element;
};

describe('SetupWizard', () => {
  afterEach(() => {
    cleanup();
  });

  it.each([375, 1280])('renders required setup anchors without shell overflow at %ipx', (width) => {
    const shell = renderAtWidth(width);

    expectAnchor('setup-wizard-header');
    expectAnchor('project-settings');
    expectAnchor('site-name-input');
    expectAnchor('persona-editor');
    expectAnchor('source-editor');
    expectAnchor('agent-editor');
    expectAnchor('nav-tree');
    expectAnchor('nav-node-overview');
    expectAnchor('theme-token-editor');
    expectAnchor('component-selector');
    expectAnchor('caps-editor');
    expectAnchor('theme-preview');
    expectAnchor('wizard-summary');
    expectAnchor('wizard-save');
    expect(shell.scrollWidth).toBeLessThanOrEqual(shell.clientWidth);
  });

  it('saves edited config, IA, and theme-token draft data', async () => {
    const saved: SetupWizardSaveInput[] = [];
    renderAtWidth(1280, (input) => {
      saved.push(input);
    });

    fireEvent.change(screen.getByTestId('site-name-input'), { target: { value: 'Renamed Docs' } });
    fireEvent.change(screen.getByTestId('site-description-input'), {
      target: { value: 'Docs for the renamed fixture.' }
    });
    fireEvent.change(screen.getByTestId('site-url-input'), { target: { value: 'https://docs.example.com' } });
    fireEvent.change(screen.getByTestId('site-locale-input'), { target: { value: 'en-US' } });
    fireEvent.change(screen.getByTestId('persona-title-0'), { target: { value: 'Platform developer' } });
    fireEvent.change(screen.getByTestId('persona-goals-0'), { target: { value: 'ship safely\nfind APIs' } });
    fireEvent.click(screen.getByTestId('add-persona'));
    fireEvent.change(screen.getByTestId('persona-title-1'), { target: { value: 'Maintainer' } });
    fireEvent.click(screen.getByTestId('add-source'));
    fireEvent.change(screen.getByTestId('source-value-0'), { target: { value: 'packages/core/src' } });
    fireEvent.change(screen.getByTestId('agent-writer-model'), { target: { value: 'gpt-5.5' } });
    fireEvent.change(screen.getByTestId('agent-reviewer-adapter'), { target: { value: 'claude' } });
    fireEvent.click(screen.getByTestId('component-Callout'));
    fireEvent.change(screen.getByTestId('cap-max-pages'), { target: { value: '12' } });
    fireEvent.click(screen.getByTitle('Add child page'));
    fireEvent.click(screen.getByTestId('wizard-save'));

    await waitFor(() => expect(saved).toHaveLength(1));
    const savedConfig = saved[0]!.config;
    expect(docstubeConfigSchema.safeParse(savedConfig).success).toBe(true);
    expect(savedConfig.site).toEqual({
      name: 'Renamed Docs',
      description: 'Docs for the renamed fixture.',
      url: 'https://docs.example.com',
      locale: 'en-US'
    });
    expect(savedConfig.personas.map((persona) => persona.title)).toEqual(['Platform developer', 'Maintainer']);
    expect(savedConfig.personas[0]?.goals).toEqual(['ship safely', 'find APIs']);
    expect(savedConfig.sources).toEqual([{ kind: 'path', path: 'packages/core/src' }]);
    expect(savedConfig.agents.writer.model).toBe('gpt-5.5');
    expect(savedConfig.agents.reviewer?.adapter).toBe('claude');
    expect(savedConfig.theme?.components).not.toContain('Callout');
    expect(savedConfig.caps?.maxPages).toBe(12);
    expect(saved[0]?.ia.nav[0]?.children?.[0]?.id).toBe('new-page-1');
    expect(saved[0]?.themeTokens.accent).toBe('#2563eb');
  });
});
