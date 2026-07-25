// Public API of @docstube/agent-runtime — the unified BYO-AI harness (ARCHITECTURE.md §8).
// This file is the deliberate package surface, not a convenience aggregator: consumers import the
// package name, package-internal code imports the concrete files.

export { runAgentTask } from './harness.ts';
export type { RunAgentTaskOptions } from './harness.ts';

export { createObservedReadsCollector, createStandardTools, standardToolDescriptors } from './tools.ts';
export type { ObservedReadsCollector, StandardToolsOptions, ToolImplementation } from './tools.ts';

export {
  CLAIM_ELEMENT_NAME,
  createSubmitPageTool,
  elementPolicySchema,
  evaluateSubmitPageCall,
  isPrototypeMutatingName,
  normalizeElementPolicy,
  readStaticJsonLiteral,
  scanClaimMarkers,
  submitPageDescriptor,
  validateSubmission
} from './submit-page.ts';
export type {
  AcceptedSubmission,
  ClaimMarker,
  ElementPolicy,
  MarkerScan,
  MarkerScanError,
  MarkerScanErrorCode,
  StaticLiteral,
  StaticLiteralResult,
  SubmitPageResponse,
  SubmitPageTool
} from './submit-page.ts';

export type {
  AssistantTurn,
  CompleteInput,
  LoopMessage,
  LoopTransport,
  ReplayLookupInput,
  ReplayTransport,
  SessionHooks,
  SessionOutcome,
  SessionRunInput,
  SessionTransport,
  SessionTurn,
  TokenUsage,
  ToolCallBlock,
  ToolResultBlock,
  Transport,
  TransportCapabilities,
  TranscriptSink
} from './transport.ts';

export { createTranscriptCache } from './cache.ts';
export type { TranscriptCache } from './cache.ts';

export { checkJsonSchema } from './json-schema-check.ts';
export type { JsonSchemaIssue } from './json-schema-check.ts';

export {
  BudgetExceededError,
  isRateLimitSignal,
  ReplayMismatchError,
  ToolPolicyError,
  TransportError,
  TransportNotImplementedError
} from './errors.ts';

export {
  buildAnthropicRequestBody,
  createAnthropicApiTransport,
  mapAnthropicResponse
} from './transports/anthropic-api.ts';
export type { AnthropicApiTransportOptions } from './transports/anthropic-api.ts';

export {
  buildOpenAiRequestBody,
  createOpenAiCompatibleTransport,
  mapOpenAiResponse,
  ollamaPreset,
  openAiPreset
} from './transports/openai-compatible.ts';
export type { OpenAiCompatibleTransportOptions } from './transports/openai-compatible.ts';

export {
  buildClaudeCliArgs,
  buildClaudeMcpConfig,
  createClaudeCliTransport,
  parseClaudeStreamEvents,
  parseObservedReadLines
} from './transports/claude-cli.ts';
export type {
  ClaudeCliArgsInput,
  ClaudeCliTransportOptions,
  ClaudeStreamParseResult
} from './transports/claude-cli.ts';

export { createCodexCliTransport } from './transports/codex-cli.ts';
export { createGoogleTransport } from './transports/google.ts';

export {
  createReplayTransport,
  recordingWrapper,
  replayFixtureFileName,
  sanitizeTranscript
} from './transports/replay.ts';

export { handleMcpMessage, mcpServerEnvVars, runMcpStdioServer } from './mcp-stdio-server.ts';
export type { McpServerOptions } from './mcp-stdio-server.ts';

export { runSubprocess } from './subprocess.ts';
export type { SubprocessRequest, SubprocessResult, SubprocessRunner } from './subprocess.ts';
