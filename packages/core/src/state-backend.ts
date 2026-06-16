import { pageStatuses } from '@docstube/contracts';
import type { DocstubeConfig, FeedbackRecord, Finding, Ia, PageId, Timestamp } from '@docstube/contracts';

// Async, versioned `StateBackend` interface.
//
// The state backend is the seam between the pipeline/UI and durable state. `LocalBackend` is the
// SQLite implementation; a future hosted backend implements the same contract (PLAN.md keeps the
// client-side seam without designing remote state). Every method is async so a remote backend can
// satisfy the contract unchanged. The contract is versioned so a client can detect a backend it
// cannot talk to.

export const STATE_BACKEND_VERSION = 1;

// Run lifecycle for the generation dashboard.
export const runStatuses = ['queued', 'running', 'completed', 'failed', 'cancelled'] as const;

export type RunStatus = (typeof runStatuses)[number];

// Page lifecycle for the dashboard and review navigation. The two terminal gate outcomes reuse the
// frozen `passed`/`flagged` contract page statuses; the earlier states are in-flight progress.
export const pageProgressStatuses = ['queued', 'running', 'retrying', ...pageStatuses] as const;

export type PageProgress = (typeof pageProgressStatuses)[number];

export type RunRecord = {
  id: string;
  status: RunStatus;
  capFrozen: boolean;
  note?: string;
  startedAt: Timestamp;
  updatedAt: Timestamp;
};

export type PageSummary = {
  id: PageId;
  runId: string;
  title: string;
  status: PageProgress;
  approved: boolean;
  updatedAt: Timestamp;
};

export type PageDetail = PageSummary & {
  slug?: string;
  findings: Finding[];
};

export type IaProposal = {
  id: string;
  runId?: string;
  label?: string;
  ia: Ia;
  createdAt: Timestamp;
};

export type ThemeTokens = Record<string, string | number>;

// Structured boundary error so callers never have to parse strings to react to state failures.
export type StateBackendErrorCode = 'not_found' | 'invalid';

export class StateBackendError extends Error {
  readonly code: StateBackendErrorCode;

  constructor(code: StateBackendErrorCode, message: string) {
    super(message);
    this.name = 'StateBackendError';
    this.code = code;
  }
}

export type StateBackend = {
  readonly version: number;

  // Config (docstube.yml) read/write.
  getConfig(): Promise<DocstubeConfig | null>;
  setConfig(config: DocstubeConfig): Promise<void>;

  // IA proposals surfaced to the setup wizard.
  listIaProposals(): Promise<IaProposal[]>;
  saveIaProposal(proposal: IaProposal): Promise<IaProposal>;

  // Theme token read/write for the token editor.
  getThemeTokens(): Promise<ThemeTokens>;
  setThemeTokens(tokens: ThemeTokens): Promise<void>;

  // Run status and page progress for the dashboard.
  getRun(runId: string): Promise<RunRecord | null>;
  saveRun(run: RunRecord): Promise<RunRecord>;
  listPages(runId?: string): Promise<PageSummary[]>;
  getPage(pageId: string): Promise<PageDetail | null>;
  upsertPage(page: PageDetail): Promise<PageDetail>;

  // Review actions.
  submitFeedback(record: FeedbackRecord): Promise<FeedbackRecord>;
  listFeedback(pageId?: string): Promise<FeedbackRecord[]>;
  approvePage(pageId: string): Promise<PageDetail>;
  regeneratePage(pageId: string): Promise<PageDetail>;

  close(): Promise<void>;
};
