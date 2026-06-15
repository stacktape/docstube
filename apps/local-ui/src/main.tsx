import { createRoot } from 'react-dom/client';

function App() {
  return (
    <main>
      <h1>docstube</h1>
      <p>Local control plane scaffold. Implement the wizard and review UI in S7 order from PLAN.md.</p>
    </main>
  );
}

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found.');
}

createRoot(rootElement).render(<App />);
