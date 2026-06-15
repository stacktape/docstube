export type DeterministicCheckStatus = 'error' | 'fail' | 'pass' | 'skipped' | 'warn';

export type DeterministicCheckResult = {
  checkId: string;
  message?: string;
  status: DeterministicCheckStatus;
};

export const deterministicCheckStatuses = ['pass', 'fail', 'warn', 'skipped', 'error'] as const;
