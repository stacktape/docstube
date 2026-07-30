import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Dashboard } from './dashboard.tsx';
import { FlagQueue } from './flag-queue.tsx';
import { Review } from './review.tsx';
import { TrpcProvider, createControlPlaneClient, readSessionFromUrl, useTrpc } from './trpc-client.ts';
import { Wizard } from './wizard.tsx';

// The local control plane shell (PRODUCT §3.9): all four surfaces — setup wizard, generation
// dashboard, review UI, and the flag queue.
//
// THE INITIAL SURFACE IS SERVER-DECIDED (PRODUCT §3.9.1). A fresh repository has no docstube.yml,
// and landing it on an empty dashboard that tells the user to run a command is the first-run bug
// this shell used to have. `setup.status` answers which surface to open; the client never guesses.

type TabId = 'dashboard' | 'flags' | 'wizard' | 'review';

const tabs: Array<{ id: TabId; label: string }> = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'flags', label: 'Flag queue' },
  { id: 'wizard', label: 'Wizard' },
  { id: 'review', label: 'Review' }
];

function Surfaces() {
  const trpc = useTrpc();
  const [activeTab, setActiveTab] = useState<TabId | undefined>();

  const statusQuery = useQuery({
    queryKey: ['setup-status'],
    queryFn: () => trpc.setup.status.query(),
    retry: false,
    // The answer decides the landing surface once; later navigation is the user's.
    staleTime: Infinity
  });

  const initialSurface = statusQuery.data?.initialSurface;
  useEffect(() => {
    if (activeTab !== undefined || initialSurface === undefined) {
      return;
    }
    setActiveTab(initialSurface === 'setup' ? 'wizard' : 'dashboard');
  }, [activeTab, initialSurface]);

  // An unreachable control plane must not strand the shell: fall back to the dashboard, which
  // renders its own error.
  useEffect(() => {
    if (activeTab === undefined && statusQuery.isError) {
      setActiveTab('dashboard');
    }
  }, [activeTab, statusQuery.isError]);

  if (activeTab === undefined) {
    return <p className="p-6 text-sm text-neutral-400">Checking this repository…</p>;
  }

  // First run has no dashboard, no flags and no pages to review — showing them as peer tabs is a
  // fake affordance, so setup owns the whole window until config exists.
  const firstRun = statusQuery.data?.hasConfig === false;

  return (
    <div className="flex min-h-screen flex-col bg-neutral-950 text-neutral-100">
      <header className="flex items-center gap-6 border-b border-neutral-800 px-4">
        <h1 className="py-3 text-sm font-semibold tracking-tight">docstube</h1>
        {firstRun ? (
          <p className="py-3 text-sm text-neutral-400">First-run setup</p>
        ) : (
          <nav className="flex gap-1" aria-label="Surfaces">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                aria-current={activeTab === tab.id ? 'page' : undefined}
                onClick={() => setActiveTab(tab.id)}
                className={`border-b-2 px-3 py-3 text-sm ${
                  activeTab === tab.id
                    ? 'border-neutral-100 text-neutral-100'
                    : 'border-transparent text-neutral-400 hover:text-neutral-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        )}
      </header>
      <main className="flex min-h-0 flex-1 flex-col">
        {activeTab === 'dashboard' && <Dashboard />}
        {activeTab === 'flags' && <FlagQueue />}
        {activeTab === 'wizard' && (
          <Wizard
            onComplete={() => {
              void statusQuery.refetch();
              setActiveTab('dashboard');
            }}
          />
        )}
        {activeTab === 'review' && <Review />}
      </main>
    </div>
  );
}

export function App() {
  const session = useMemo(readSessionFromUrl, []);
  const client = useMemo(() => (session === undefined ? undefined : createControlPlaneClient(session)), [session]);

  if (client === undefined) {
    return (
      <div className="flex min-h-screen flex-col bg-neutral-950 text-neutral-100">
        <header className="flex items-center gap-6 border-b border-neutral-800 px-4">
          <h1 className="py-3 text-sm font-semibold tracking-tight">docstube</h1>
        </header>
        <main className="grid flex-1 place-items-center p-6">
          <div className="max-w-md space-y-2 text-center">
            <h2 className="text-lg font-semibold">Missing session token</h2>
            <p className="text-sm text-neutral-400">
              Open this UI through the URL printed by <code className="text-neutral-200">docstube</code> — it carries
              the one-time session token the control plane requires.
            </p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <TrpcProvider value={client}>
      <Surfaces />
    </TrpcProvider>
  );
}
