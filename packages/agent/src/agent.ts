export type BuiltInAgentId = 'api' | 'claude' | 'codex' | 'gemini';

export type AgentRunInput = {
  prompt: string;
  readOnlyRoots: string[];
  writableRoots: string[];
};

export type AgentRunResult = {
  adapterId: string;
  output: unknown;
};

export type AgentAdapter = {
  id: BuiltInAgentId | string;
  run: (input: AgentRunInput) => Promise<AgentRunResult>;
};

export const builtInAgentIds = ['api', 'claude', 'codex', 'gemini'] as const;
