import type { AgentTaskSpec, ToolDescriptor, Transcript } from '@docstube/contracts';
import { agentRoleForTaskKind } from '@docstube/contracts';
import type { RunJournal } from '../state/run-journal.ts';
import type { RunCostTracker } from './run-cost.ts';

// ONE PLACE A MODEL TASK IS RECORDED. Journal the start, run it, journal the completion, attribute
// the spend — all stamped with the ROLE the task's kind routes under (agentRoleForTaskKind), so a
// new task-issuing site cannot forget the role and quietly make run spend unattributable.
//
// The runner is typed structurally (rather than importing page-runner's TaskRunner) so this module
// stays free of a cycle with the page loop that uses it.

type TaskToolLike = { descriptor: ToolDescriptor; handler: (args: unknown) => Promise<unknown> };

export const runRecordedTask = async (input: {
  runTask: (spec: AgentTaskSpec, extraTools?: TaskToolLike[]) => Promise<Transcript>;
  journal: RunJournal;
  task: AgentTaskSpec;
  costTracker?: RunCostTracker | undefined;
  pageId?: string | undefined;
  extraTools?: TaskToolLike[] | undefined;
}): Promise<Transcript> => {
  const role = agentRoleForTaskKind(input.task.kind);
  const pageId = input.pageId === undefined ? {} : { pageId: input.pageId };
  await input.journal.append({ type: 'task-started', taskId: input.task.id, role, ...pageId });
  const transcript = await input.runTask(input.task, input.extraTools);
  await input.journal.append({
    type: 'task-completed',
    taskId: input.task.id,
    role,
    ...pageId,
    usage: transcript.usage
  });
  input.costTracker?.add(transcript.usage, role);
  return transcript;
};
