import { z } from 'zod';
import type { ToolDescriptor } from '@docstube/contracts';
import { MISSING_FACT_KINDS } from '../knowledge/knowledge-slots.ts';
import type { CapturedQuestion } from '../knowledge/knowledge-session.ts';

// The HARNESS surface of tribal-knowledge capture (PRODUCT §4.1): when generation hits something
// the code cannot answer ("why was X deprecated?"), the writer asks through this tool. Generation
// never waits — the question becomes a KnowledgeNeed plus a queue flag, and the page ships.
//
// Identity, dedup, answering, staleness, and propagation all live in ../knowledge/. This file owns
// only what the agent sees.

const flagQuestionParams = z.object({
  question: z.string().min(8),
  subject: z.string().optional(),
  context: z.string().optional(),
  factKind: z.string().optional(),
  factField: z.string().optional()
});

export const flagQuestionDescriptor: ToolDescriptor = {
  name: 'flag_question',
  description:
    'Ask the maintainers something the code cannot answer (intent, history, "why"). Non-blocking: keep writing with what IS knowable; the answer arrives on a future run. `subject` names the symbol/file the question is about — questions are deduplicated by subject + missing fact, so naming the subject is what stops the same question being asked twice.',
  paramsJsonSchema: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'The question for the maintainers, self-contained.' },
      subject: { type: 'string', description: 'Symbol or file the question is about (strongly recommended).' },
      context: { type: 'string', description: 'Why the answer matters for the docs (optional).' },
      factKind: {
        type: 'string',
        description: `What kind of fact is missing: ${MISSING_FACT_KINDS.join(', ')} (optional).`,
        enum: [...MISSING_FACT_KINDS]
      },
      factField: {
        type: 'string',
        description: 'Which specific aspect of that fact you need, e.g. "deprecation-reason" (optional).'
      }
    },
    required: ['question']
  }
};

export type QuestionCollector = {
  tool: { descriptor: ToolDescriptor; handler: (args: unknown) => Promise<unknown> };
  questions: () => CapturedQuestion[];
};

export const createQuestionCollector = (): QuestionCollector => {
  const captured: CapturedQuestion[] = [];
  return {
    tool: {
      descriptor: flagQuestionDescriptor,
      handler: async (args) => {
        const parsed = flagQuestionParams.parse(args);
        captured.push(parsed);
        return {
          recorded: true,
          note: 'Question flagged for the maintainers. Continue writing with what the code supports.'
        };
      }
    },
    questions: () => [...captured]
  };
};
