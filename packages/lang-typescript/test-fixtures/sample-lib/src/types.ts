export interface RetryOptions {
  retries: number;
  delayMs?: number;
}

export type RetryResult = 'ok' | 'failed';

export enum LogLevel {
  Info,
  Warn
}

export const DEFAULT_RETRIES = 3;

const internalLimit = 10;

export { internalLimit as EXPORTED_LIMIT };
