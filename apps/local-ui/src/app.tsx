import { useMemo, useState } from 'react';
import { Dashboard } from './dashboard.tsx';
import { FlagQueue } from './flag-queue.tsx';
import { TrpcProvider, createControlPlaneClient, readSessionFromUrl } from './trpc-client.ts';

// The local control plane shell (PRODUCT §3.9). This wave ships the generation dashboard and the
// flag queue; the setup wizard and review UI are later waves and stay visibly disabled — never
// faked.

type TabId = 'dashboard' | 'flags' | 'wizard' | 'review';

const tabs: Array<{ id: TabId; label: string; disabled?: boolean }> = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'flags', label: 'Flag queue' },
  { id: 'wizard', label: 'Wizard', disabled: true },
  { id: 'review', label: 'Review', disabled: true }
];

export function App() {
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');
  const session = useMemo(readSessionFromUrl, []);
  const client = useMemo(() => (session === undefined ? undefined : createControlPlaneClient(session)), [session]);

  return (
    <div className="flex min-h-screen flex-col bg-neutral-950 text-neutral-100">
      <header className="flex items-center gap-6 border-b border-neutral-800 px-4">
        <h1 className="py-3 text-sm font-semibold tracking-tight">docstube</h1>
        <nav className="flex gap-1" aria-label="Surfaces">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              disabled={tab.disabled}
              aria-current={activeTab === tab.id ? 'page' : undefined}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 border-b-2 px-3 py-3 text-sm ${
                activeTab === tab.id
                  ? 'border-neutral-100 text-neutral-100'
                  : 'border-transparent text-neutral-400 hover:text-neutral-200'
              } disabled:cursor-not-allowed disabled:text-neutral-600 disabled:hover:text-neutral-600`}
            >
              {tab.label}
              {tab.disabled && (
                <span className="rounded bg-neutral-900 px-1.5 py-0.5 text-[10px] text-neutral-500">next wave</span>
              )}
            </button>
          ))}
        </nav>
      </header>
      <main className="flex min-h-0 flex-1 flex-col">
        {client === undefined ? (
          <div className="grid flex-1 place-items-center p-6">
            <div className="max-w-md space-y-2 text-center">
              <h2 className="text-lg font-semibold">Missing session token</h2>
              <p className="text-sm text-neutral-400">
                Open this UI through the URL printed by <code className="text-neutral-200">docstube wizard</code> — it
                carries the one-time session token the control plane requires.
              </p>
            </div>
          </div>
        ) : (
          <TrpcProvider value={client}>
            {activeTab === 'dashboard' && <Dashboard />}
            {activeTab === 'flags' && <FlagQueue />}
          </TrpcProvider>
        )}
      </main>
    </div>
  );
}
