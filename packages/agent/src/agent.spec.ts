import { describe, expect, it } from 'vitest';
import {
  AgentReplayMismatchError,
  agentReplayFixtureSchema,
  agentRunInputSchema,
  artifactPaths,
  createMockAgentAdapter,
  createReplayAgentAdapter
} from './agent';
import type { AgentReplayFixture, AgentRunInput } from './agent';

const input: AgentRunInput = agentRunInputSchema.parse({
  taskId: 'walking-skeleton',
  prompt: 'Generate the overview page.',
  model: 'mock-model',
  sandbox: {
    readOnlyRoots: ['C:/repo'],
    writableRoots: ['C:/repo/docs'],
    allowNetwork: false,
    shell: 'none'
  }
});

const fixture: AgentReplayFixture = agentReplayFixtureSchema.parse({
  version: 1,
  name: 'walking-skeleton',
  recordedAt: '2026-06-16T00:00:00.000Z',
  input,
  result: {
    adapterId: 'mock',
    adapterVersion: '0.0.0',
    status: 'completed',
    startedAt: '2026-06-16T00:00:00.000Z',
    completedAt: '2026-06-16T00:00:01.000Z',
    events: [
      {
        type: 'run-started',
        sequence: 0,
        timestamp: '2026-06-16T00:00:00.000Z',
        adapterId: 'mock',
        adapterVersion: '0.0.0',
        model: 'mock-model',
        sandbox: input.sandbox
      },
      {
        type: 'artifact-written',
        sequence: 1,
        timestamp: '2026-06-16T00:00:01.000Z',
        path: 'docs/overview.mdx',
        bytes: 42
      },
      {
        type: 'run-completed',
        sequence: 2,
        timestamp: '2026-06-16T00:00:01.000Z',
        exitCode: 0
      }
    ],
    artifacts: [{ path: 'docs/overview.mdx', content: '# Overview', encoding: 'utf8' }]
  }
});

describe('AgentAdapter contract helpers', () => {
  it('normalizes mock adapter output with events and artifacts', async () => {
    const adapter = createMockAgentAdapter({
      artifacts: [{ path: 'docs/overview.mdx', content: '# Overview', encoding: 'utf8' }],
      output: { pageId: 'overview' }
    });

    const result = await adapter.run(input);
    expect(result.status).toBe('completed');
    expect(result.events.map((event) => event.type)).toEqual(['run-started', 'message', 'run-completed']);
    expect(artifactPaths(result)).toEqual(['docs/overview.mdx']);
  });

  it('replays a fixture only for the exact recorded input', async () => {
    const adapter = createReplayAgentAdapter(fixture);
    await expect(adapter.run(input)).resolves.toEqual(fixture.result);

    await expect(adapter.run({ ...input, prompt: 'Different prompt' })).rejects.toBeInstanceOf(
      AgentReplayMismatchError
    );
  });

  it('rejects unsafe artifact paths in replay fixtures', () => {
    expect(() =>
      agentReplayFixtureSchema.parse({
        ...fixture,
        result: {
          ...fixture.result,
          artifacts: [{ path: '../outside.mdx', content: '# Bad' }]
        }
      })
    ).toThrow('path must not contain');
  });
});
