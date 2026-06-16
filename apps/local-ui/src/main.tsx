import { createRoot } from 'react-dom/client';
import { ProductApp } from './product-app.tsx';
import type { ProductView } from './product-app.tsx';
import { createLocalUiClient } from './setup-trpc.ts';
// oxlint-disable-next-line import/no-unassigned-import -- Vite loads app-level CSS from the entry module.
import './styles.css';

const productViews = new Set<ProductView>(['dashboard', 'review', 'setup']);

const viewFromSearch = (search: URLSearchParams): ProductView => {
  const view = search.get('view');
  return view && productViews.has(view as ProductView) ? (view as ProductView) : 'setup';
};

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found.');
}

const search = new URLSearchParams(window.location.search);
const sessionToken = search.get('session');

if (!sessionToken) {
  createRoot(rootElement).render(
    <main className="setup-shell" data-testid="app-error">
      <section className="setup-panel">
        <div className="panel-heading">
          <h2>Missing session</h2>
        </div>
        <p className="empty-note">Open docstube through the local control plane so the session token is available.</p>
      </section>
    </main>
  );
} else {
  createRoot(rootElement).render(
    <ProductApp
      client={createLocalUiClient(sessionToken)}
      configPath={search.get('configPath') ?? undefined}
      view={viewFromSearch(search)}
    />
  );
}
