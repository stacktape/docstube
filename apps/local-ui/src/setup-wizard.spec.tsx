// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DocstubeConfig, Ia } from '@docstube/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { SetupWizard } from './setup-wizard';
import type { SetupWizardSaveInput } from './setup-wizard';

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
    expectAnchor('nav-tree');
    expectAnchor('nav-node-overview');
    expectAnchor('theme-token-editor');
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
    fireEvent.click(screen.getByTitle('Add child page'));
    fireEvent.click(screen.getByTestId('wizard-save'));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]?.config.site.name).toBe('Renamed Docs');
    expect(saved[0]?.ia.nav[0]?.children?.[0]?.id).toBe('new-page-1');
    expect(saved[0]?.themeTokens.accent).toBe('#2563eb');
  });
});
