import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import type { ToolImplementation } from './tools.ts';

// Minimal MCP server: JSON-RPC 2.0 over newline-delimited stdio, implementing only the subset a
// vendor CLI needs to see our tools (initialize, notifications/initialized, tools/list, tools/call).
// No SDK dependency — the protocol subset is small and this file is the whole surface.
//
// Tool calls route through the same ToolImplementation handlers the in-process harness uses, so
// observed reads are recorded even when the vendor CLI is the caller: the executable entry wires
// a collector whose sink appends JSONL to DOCSTUBE_MCP_OBSERVED_READS_FILE for the parent process.

const JSON_RPC_METHOD_NOT_FOUND = -32601;
const MCP_PROTOCOL_VERSION = '2025-06-18';

export type McpServerOptions = {
  tools: ToolImplementation[];
  serverName?: string;
  serverVersion?: string;
};

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
};

export const handleMcpMessage = async (
  message: unknown,
  options: McpServerOptions
): Promise<Record<string, unknown> | undefined> => {
  const request = (message ?? {}) as JsonRpcRequest;
  if (typeof request.method !== 'string') {
    return undefined;
  }
  if (request.method.startsWith('notifications/')) {
    return undefined;
  }
  const respond = (result: unknown): Record<string, unknown> => ({ jsonrpc: '2.0', id: request.id ?? null, result });

  if (request.method === 'initialize') {
    const clientProtocol = request.params?.protocolVersion;
    return respond({
      protocolVersion: typeof clientProtocol === 'string' ? clientProtocol : MCP_PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: options.serverName ?? 'docstube-tools', version: options.serverVersion ?? '0.0.1' }
    });
  }
  if (request.method === 'ping') {
    return respond({});
  }
  if (request.method === 'tools/list') {
    return respond({
      tools: options.tools.map((tool) => ({
        name: tool.descriptor.name,
        description: tool.descriptor.description,
        inputSchema: tool.descriptor.paramsJsonSchema
      }))
    });
  }
  if (request.method === 'tools/call') {
    const name = typeof request.params?.name === 'string' ? request.params.name : '';
    const tool = options.tools.find((candidate) => candidate.descriptor.name === name);
    if (!tool) {
      return respond({ content: [{ type: 'text', text: `unknown tool: ${name}` }], isError: true });
    }
    try {
      const result = await tool.handler(request.params?.arguments ?? {});
      return respond({
        content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) }]
      });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      return respond({ content: [{ type: 'text', text }], isError: true });
    }
  }
  return {
    jsonrpc: '2.0',
    id: request.id ?? null,
    error: { code: JSON_RPC_METHOD_NOT_FOUND, message: `method not found: ${request.method}` }
  };
};

export const runMcpStdioServer = async (
  options: McpServerOptions & { input?: Readable; output?: Writable }
): Promise<void> => {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    let message: unknown;
    try {
      message = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const response = await handleMcpMessage(message, options);
    if (response) {
      output.write(`${JSON.stringify(response)}\n`);
    }
  }
};

// Configuration for the executable entry (mcp-stdio-server-bin.ts), passed by the spawning
// transport via env vars.
export const mcpServerEnvVars = {
  repoRoot: 'DOCSTUBE_MCP_REPO_ROOT',
  readRoots: 'DOCSTUBE_MCP_READ_ROOTS',
  observedReadsFile: 'DOCSTUBE_MCP_OBSERVED_READS_FILE',
  // Forwarded task-specific tools (see transports/forwarded-tools.ts): descriptors in, calls out.
  extraToolsFile: 'DOCSTUBE_MCP_EXTRA_TOOLS_FILE',
  toolCallsFile: 'DOCSTUBE_MCP_TOOL_CALLS_FILE'
} as const;
