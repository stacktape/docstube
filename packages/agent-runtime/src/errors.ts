// Typed errors at the package boundary (CLAUDE.md rule). Transport failures carry retry semantics
// so the orchestrator can distinguish "try again later" (rate limit, 5xx, timeout) from "fix the input".

export const isRateLimitSignal = (output: string): boolean =>
  /\b(429|rate.?limit(ed)?|quota exceeded|too many requests|overloaded)\b/i.test(output);

export class TransportError extends Error {
  readonly transport: string;
  readonly retryable: boolean;
  readonly rateLimited: boolean;

  constructor(input: { transport: string; message: string; retryable?: boolean; rateLimited?: boolean }) {
    super(input.message);
    this.name = 'TransportError';
    this.transport = input.transport;
    this.rateLimited = input.rateLimited ?? isRateLimitSignal(input.message);
    this.retryable = input.retryable ?? this.rateLimited;
  }
}

export class ToolPolicyError extends Error {
  readonly tool: string;

  constructor(input: { tool: string; message: string }) {
    super(input.message);
    this.name = 'ToolPolicyError';
    this.tool = input.tool;
  }
}

export class BudgetExceededError extends Error {
  readonly budget: 'max-turns' | 'max-tool-calls';

  constructor(input: { budget: 'max-turns' | 'max-tool-calls'; message: string }) {
    super(input.message);
    this.name = 'BudgetExceededError';
    this.budget = input.budget;
  }
}

export class TransportNotImplementedError extends Error {
  readonly transport: string;
  readonly reason: string;

  constructor(input: { transport: string; reason: string }) {
    super(`transport "${input.transport}" is not implemented: ${input.reason}`);
    this.name = 'TransportNotImplementedError';
    this.transport = input.transport;
    this.reason = input.reason;
  }
}

export class ReplayMismatchError extends Error {
  readonly availableFixtures: string[];

  constructor(input: { message: string; availableFixtures: string[] }) {
    super(`${input.message}; available fixtures: ${input.availableFixtures.join(', ') || '(none)'}`);
    this.name = 'ReplayMismatchError';
    this.availableFixtures = input.availableFixtures;
  }
}
