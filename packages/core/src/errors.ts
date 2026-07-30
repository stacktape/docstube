// Typed errors at the kernel boundary. Every error carries a stable `code` so the CLI and UI can
// present actionable messages without string-matching.

export type CoreErrorCode =
  | 'config-invalid'
  | 'config-missing'
  | 'plugin-load-failed'
  | 'plugin-capability-mismatch'
  | 'state-corrupt'
  | 'pipeline-failed'
  // A second run was asked for while one is already in flight in this workspace (run-lock.ts).
  | 'run-in-progress';

export class CoreError extends Error {
  readonly code: CoreErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: CoreErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'CoreError';
    this.code = code;
    this.details = details;
  }
}

export const configError = (message: string, details?: Record<string, unknown>): CoreError =>
  new CoreError('config-invalid', message, details);

export const pluginLoadError = (message: string, details?: Record<string, unknown>): CoreError =>
  new CoreError('plugin-load-failed', message, details);
