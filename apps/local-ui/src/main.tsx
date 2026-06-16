import { createRoot } from 'react-dom/client';
import type { DocstubeConfig, Ia } from '@docstube/contracts';
import { createSetupWizardSaver } from './setup-trpc';
import { SetupWizard } from './setup-wizard';
// oxlint-disable-next-line import/no-unassigned-import -- Vite loads app-level CSS from the entry module.
import './styles.css';

const initialConfig: DocstubeConfig = {
  version: 1,
  site: { name: 'docstube', locale: 'en' },
  docsType: 'library',
  output: { dir: 'docs', layout: 'single-tree' },
  personas: [{ id: 'developer', title: 'Developer' }],
  agents: { writer: { adapter: 'codex', model: 'default' } },
  ia: 'ia.yml',
  glossary: 'glossary.yaml',
  theme: { credit: true, tokens: { accent: '#2563eb', surface: '#f8fafc', radius: 8 } }
};

const initialIa: Ia = {
  version: 1,
  layout: 'single-tree',
  nav: [
    {
      id: 'overview',
      title: 'Overview',
      path: 'overview.mdx',
      brief: 'Project overview and primary concepts.'
    }
  ]
};

const sessionToken = new URLSearchParams(window.location.search).get('session');
const saveDraft = sessionToken
  ? createSetupWizardSaver(sessionToken)
  : async () => {
      console.info('docstube setup draft updated.');
    };

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found.');
}

createRoot(rootElement).render(
  <SetupWizard
    initialConfig={initialConfig}
    initialIa={initialIa}
    initialThemeTokens={initialConfig.theme?.tokens}
    onSave={saveDraft}
  />
);
