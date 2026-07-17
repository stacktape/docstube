import type { FailureModeCode } from '@docstube/contracts';

export type CliOutput = {
  error: (message: string) => void;
  info: (message: string) => void;
};

export type CliCommandResult = {
  exitCode: number;
  // Coarse failure-mode counts from the run summary (registry codes only) — telemetry input.
  failureModes?: Partial<Record<FailureModeCode, number>> | undefined;
};

export const defaultOutput: CliOutput = {
  info: (message) => console.info(message),
  error: (message) => console.error(message)
};
