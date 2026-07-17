import type { CliOutput } from '../cli-output.ts';

// One spend line for generate/refresh/refine: when any task's cost had to be estimated from
// tokens (transports that report no costUsd), the total is labeled as partly estimated so the
// number is never mistaken for a vendor-reported bill.
export const reportRunSpend = (
  output: CliOutput,
  summary: { spentUsd?: number | undefined; estimatedUsd?: number | undefined; planUsedPercent?: number | undefined }
): void => {
  if (summary.planUsedPercent !== undefined) {
    output.info(`subscription plan usage: ${Math.round(summary.planUsedPercent)}% of the busier window`);
  }
  if (summary.estimatedUsd !== undefined) {
    const total = (summary.spentUsd ?? 0) + summary.estimatedUsd;
    output.info(`agent spend this run: ~$${total.toFixed(4)} (partly estimated)`);
    return;
  }
  if (summary.spentUsd !== undefined) {
    output.info(`agent spend this run: ~$${summary.spentUsd.toFixed(4)}`);
  }
};
