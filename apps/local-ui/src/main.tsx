import { createRoot } from 'react-dom/client';
import type { DocstubeConfig, Ia } from '@docstube/contracts';
import { GenerationDashboard } from './generation-dashboard';
import type { DashboardPage } from './generation-dashboard';
import { ReviewRoom } from './review-room';
import type { ReviewPage } from './review-room';
import { createSetupWizardSaver } from './setup-trpc';
import { SetupWizard } from './setup-wizard';
// oxlint-disable-next-line import/no-unassigned-import -- Vite loads app-level CSS from the entry module.
import './styles.css';

const timestamp = new Date().toISOString();

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

const dashboardPages: DashboardPage[] = [
  {
    id: 'overview',
    runId: 'local-run',
    title: 'Overview',
    slug: 'overview.mdx',
    status: 'running',
    approved: false,
    findings: [],
    updatedAt: timestamp,
    preview: '# Overview\n\nGeneration output appears here as each page completes.',
    timeline: [
      { at: timestamp, status: 'queued', label: 'Queued for generation' },
      { at: timestamp, status: 'running', label: 'Writer is drafting the page' }
    ]
  }
];

const reviewPages: ReviewPage[] = [
  {
    id: 'overview',
    title: 'Overview',
    slug: 'overview.mdx',
    approved: false,
    findings: [],
    sections: [{ id: 'intro', title: 'Intro' }],
    renderedHtml: '<article><h1>Overview</h1><p data-review-target>Generated docs preview.</p></article>'
  }
];

const sessionToken = new URLSearchParams(window.location.search).get('session');
const currentView = new URLSearchParams(window.location.search).get('view');
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
  currentView === 'review' ? (
    <ReviewRoom pages={reviewPages} />
  ) : currentView === 'dashboard' ? (
    <GenerationDashboard
      run={{
        id: 'local-run',
        status: 'running',
        capFrozen: false,
        startedAt: timestamp,
        updatedAt: timestamp
      }}
      pages={dashboardPages}
    />
  ) : (
    <SetupWizard
      initialConfig={initialConfig}
      initialIa={initialIa}
      initialThemeTokens={initialConfig.theme?.tokens}
      onSave={saveDraft}
    />
  )
);
