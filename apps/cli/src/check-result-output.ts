import type { CheckResult } from '@docstube/contracts';
import type { CliOutput } from './cli-output.ts';

export const resultFailed = (result: CheckResult): boolean => result.status === 'failed' || result.status === 'errored';

export const printCheckResult = (output: CliOutput, result: CheckResult): void => {
  output.info(`${result.checkId}: ${result.status}`);
  if (result.status === 'failed') {
    for (const finding of result.findings) {
      output.error(`${finding.severity}: ${finding.message}`);
    }
  }
  if (result.status === 'errored') {
    output.error(result.error);
  }
  if (result.status === 'skipped') {
    output.info(result.reason);
  }
};
