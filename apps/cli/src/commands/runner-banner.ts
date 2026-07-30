import { describeRoleOverrides } from '@docstube/core';
import type { ConfiguredTaskRunner } from '@docstube/core';
import type { CliOutput } from '../cli-output.ts';

// "generating with codex-cli (gpt-5.5)…" — plus, when docstube.yml routes a role somewhere else,
// the roles that are NOT running on that transport/model. A banner that names only the primary
// while reviews quietly bill a second provider is the kind of half-truth this codebase treats as a
// defect: the line states everything the run will actually call.
export const reportRunnerRouting = (output: CliOutput, verb: string, runner: ConfiguredTaskRunner): void => {
  output.info(`${verb} with ${runner.transportId} (${runner.model})…`);
  for (const override of describeRoleOverrides(runner.routings)) {
    output.info(`  role override: ${override}`);
  }
};
