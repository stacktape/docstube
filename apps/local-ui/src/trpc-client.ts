import { createContext, useContext } from 'react';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
// Type-only import straight from core source: the `@docstube/core` package export map points at
// built output (and the router is not part of the public core surface yet), so the relative
// source path is what actually builds under Vite — `import type` is fully erased at build time.
import type {
  ControlPlaneRouter,
  FlagQueueEntry,
  RunListEntry
} from '../../../packages/core/src/server/trpc-router.ts';

export type { ControlPlaneRouter, FlagQueueEntry, RunListEntry };

export type SessionInfo = {
  sessionToken: string;
  apiBaseUrl: string;
};

// The tokened URL the control plane prints carries the session + API base as query params
// (?session=…&api=… in dev behind Vite; ?session=… when the server static-serves the built UI).
export const readSessionFromUrl = (): SessionInfo | undefined => {
  const params = new URLSearchParams(window.location.search);
  const sessionToken = params.get('session');
  if (sessionToken === null || sessionToken.length === 0) {
    return undefined;
  }
  return { sessionToken, apiBaseUrl: params.get('api') ?? window.location.origin };
};

export const createControlPlaneClient = (session: SessionInfo) =>
  createTRPCClient<ControlPlaneRouter>({
    links: [
      httpBatchLink({
        url: `${session.apiBaseUrl}/api/trpc`,
        headers: { 'x-docstube-session': session.sessionToken }
      })
    ]
  });

export type ControlPlaneClient = ReturnType<typeof createControlPlaneClient>;

// Agent-dependent mutations fail with PRECONDITION_FAILED('agent runner not configured …') when
// the control plane host injected no task runner. The UI shows that message verbatim plus a hint.
export const describeMutationError = (error: unknown): { message: string; needsAgent: boolean } => {
  const message = error instanceof Error ? error.message : String(error);
  return { message, needsAgent: message.includes('agent runner not configured') };
};

export const agentRunnerHint = 'Start the UI with `docstube wizard` so the control plane has an agent runner.';

const TrpcContext = createContext<ControlPlaneClient | undefined>(undefined);

export const TrpcProvider = TrpcContext.Provider;

export const useTrpc = (): ControlPlaneClient => {
  const client = useContext(TrpcContext);
  if (client === undefined) {
    throw new Error('useTrpc must be used inside a TrpcProvider');
  }
  return client;
};
