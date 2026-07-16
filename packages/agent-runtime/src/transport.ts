import type { AgentTaskSpec, ToolDescriptor, Transcript, TranscriptBlock } from '@docstube/contracts';
import type { ObservedReadsCollector, ToolImplementation } from './tools.ts';

// Transport contract (ARCHITECTURE.md §8.2): docstube owns the loop and the tools; a transport
// only carries model traffic. Capabilities are declared so the harness degrades explicitly.

export type TransportCapabilities = {
  toolInjection: 'native' | 'mcp' | 'none';
  structuredOutput: boolean;
};

export type ToolCallBlock = Extract<TranscriptBlock, { type: 'tool-call' }>;
export type ToolResultBlock = Extract<TranscriptBlock, { type: 'tool-result' }>;

// costUsd is set only when the vendor reports an authoritative cost (claude CLI's
// total_cost_usd); otherwise the harness estimates it from model-pricing.ts.
export type TokenUsage = { inputTokens: number; outputTokens: number; costUsd?: number };

export type LoopMessage =
  | { role: 'user'; text: string }
  | { role: 'assistant'; blocks: TranscriptBlock[] }
  | { role: 'tool'; results: ToolResultBlock[] };

export type AssistantTurn = {
  blocks: TranscriptBlock[];
  usage: TokenUsage;
  stopReason?: 'end' | 'tool-use';
};

export type CompleteInput = {
  systemPrompt: string;
  messages: LoopMessage[];
  toolDescriptors: ToolDescriptor[];
  model: string;
};

// Called by the harness with every finished transcript; recordingWrapper hooks in here.
export type TranscriptSink = (input: {
  transcript: Transcript;
  spec: AgentTaskSpec;
  repoRoot: string;
}) => Promise<void>;

type TransportCommon = {
  id: string;
  capabilities: TransportCapabilities;
  onTranscript?: TranscriptSink;
};

// Harness runs the turn loop; the transport implements a single model completion.
export type LoopTransport = TransportCommon & {
  mode: 'loop';
  complete: (input: CompleteInput) => Promise<AssistantTurn>;
};

export type SessionTurn = { role: 'assistant' | 'tool'; blocks: TranscriptBlock[] };

export type SessionRunInput = {
  spec: AgentTaskSpec;
  model: string;
  repoRoot: string;
  tools: ToolImplementation[];
  observedReads: ObservedReadsCollector;
};

export type SessionHooks = {
  onTurn: (turn: SessionTurn) => void;
};

export type SessionOutcome = {
  finalText?: string;
  usage: TokenUsage;
  stopReason: 'complete' | 'max-turns' | 'error';
  errorMessage?: string;
};

// Vendor CLI owns turn sequencing; it calls back into our tool executor (MCP stdio server).
export type SessionTransport = TransportCommon & {
  mode: 'session';
  runSession: (input: SessionRunInput, hooks: SessionHooks) => Promise<SessionOutcome>;
};

export type ReplayLookupInput = { spec: AgentTaskSpec; cacheKey: string };

// Plays recorded transcripts; the only transport CI may use (ARCHITECTURE.md §8.3).
export type ReplayTransport = TransportCommon & {
  mode: 'replay';
  loadTranscript: (input: ReplayLookupInput) => Promise<Transcript>;
};

export type Transport = LoopTransport | SessionTransport | ReplayTransport;
