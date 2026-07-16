import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toolDescriptorSchema } from '@docstube/contracts';
import { mcpServerEnvVars } from '../mcp-stdio-server.ts';
import { standardToolDescriptors } from '../tools.ts';
import type { ToolImplementation } from '../tools.ts';

// Task-specific tools across the session-transport process boundary. Handlers are closures in
// THIS process and cannot be shipped to the spawned MCP server, so forwarded tools are
// record-style: the child advertises the descriptor, acks every call with a generic "recorded"
// response, and appends {name, args} to a JSONL sink. After the session, the parent replays the
// recorded calls through the real handlers so collectors (e.g. flag_question) observe them.
// Request-response extra tools (where the model needs the real result) still require a loop
// transport — documented at the TaskRunner seam.

export type ForwardedToolsSession = {
  env: Record<string, string>;
  cleanup: () => Promise<void>;
  // Replays recorded calls through the real handlers; returns how many calls were replayed.
  replay: () => Promise<number>;
};

const standardNames = new Set(standardToolDescriptors().map((descriptor) => descriptor.name));

export const prepareForwardedTools = async (tools: ToolImplementation[]): Promise<ForwardedToolsSession> => {
  const extras = tools.filter((tool) => !standardNames.has(tool.descriptor.name));
  if (extras.length === 0) {
    return { env: {}, cleanup: async () => {}, replay: async () => 0 };
  }
  const dir = await mkdtemp(join(tmpdir(), 'docstube-fwd-tools-'));
  const descriptorsFile = join(dir, 'descriptors.json');
  const callsFile = join(dir, 'calls.jsonl');
  await writeFile(descriptorsFile, JSON.stringify(extras.map((tool) => tool.descriptor)), 'utf8');

  const byName = new Map(extras.map((tool) => [tool.descriptor.name, tool]));
  return {
    env: {
      [mcpServerEnvVars.extraToolsFile]: descriptorsFile,
      [mcpServerEnvVars.toolCallsFile]: callsFile
    },
    cleanup: () => rm(dir, { recursive: true, force: true }),
    replay: async () => {
      let raw: string;
      try {
        raw = await readFile(callsFile, 'utf8');
      } catch {
        return 0;
      }
      let replayed = 0;
      for (const line of raw.split('\n')) {
        if (line.trim() === '') {
          continue;
        }
        try {
          const call = JSON.parse(line) as { name?: string; args?: unknown };
          const tool = call.name === undefined ? undefined : byName.get(call.name);
          if (tool) {
            await tool.handler(call.args);
            replayed += 1;
          }
        } catch {
          // A malformed line or a rejecting handler never fails the session — the model already
          // received its ack; the loss is one recorded call, visible via the returned count.
        }
      }
      return replayed;
    }
  };
};

// Child-process side: rebuild record-style implementations from the descriptors file.
export const loadForwardedToolImplementations = async (
  descriptorsFile: string,
  appendCall: (line: string) => void
): Promise<ToolImplementation[]> => {
  const raw = JSON.parse(await readFile(descriptorsFile, 'utf8')) as unknown[];
  return raw.map((entry) => {
    const descriptor = toolDescriptorSchema.parse(entry);
    return {
      descriptor,
      handler: async (args: unknown) => {
        appendCall(JSON.stringify({ name: descriptor.name, args }));
        return { recorded: true, note: 'Recorded. The docstube kernel processes this after the session; continue.' };
      }
    };
  });
};
