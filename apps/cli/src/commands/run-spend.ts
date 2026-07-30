import type { RoleSpend } from '@docstube/core';
import type { CliOutput } from '../cli-output.ts';

// One spend line for generate/maintain/refine: when any task's cost had to be estimated from
// tokens (transports that report no costUsd), the total is labeled as partly estimated so the
// number is never mistaken for a vendor-reported bill.
//
// The per-ROLE breakdown follows it whenever more than one role spent anything: "where did the
// money go" is the question that makes `agents.roles.<role>.model` an informed decision instead of
// a guess. One role alone needs no breakdown — it would just restate the total.
export const reportRunSpend = (
  output: CliOutput,
  summary: {
    spentUsd?: number | undefined;
    estimatedUsd?: number | undefined;
    planUsedPercent?: number | undefined;
    spendByRole?: RoleSpend[] | undefined;
  }
): void => {
  if (summary.planUsedPercent !== undefined) {
    output.info(`subscription plan usage: ${Math.round(summary.planUsedPercent)}% of the busier window`);
  }
  if (summary.estimatedUsd !== undefined) {
    const total = (summary.spentUsd ?? 0) + summary.estimatedUsd;
    output.info(`agent spend this run: ~$${total.toFixed(4)} (partly estimated)`);
  } else if (summary.spentUsd !== undefined) {
    output.info(`agent spend this run: ~$${summary.spentUsd.toFixed(4)}`);
  }
  const byRole = (summary.spendByRole ?? []).filter((entry) => entry.spentUsd + entry.estimatedUsd > 0);
  if (byRole.length < 2) {
    return;
  }
  for (const entry of byRole) {
    output.info(`  ${entry.role}: ~$${(entry.spentUsd + entry.estimatedUsd).toFixed(4)} over ${entry.tasks} task(s)`);
  }
};
