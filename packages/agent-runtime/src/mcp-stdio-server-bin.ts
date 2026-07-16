import { appendFileSync } from 'node:fs';
import { mcpServerEnvVars, runMcpStdioServer } from './mcp-stdio-server.ts';
import { loadForwardedToolImplementations } from './transports/forwarded-tools.ts';
import { createObservedReadsCollector, createStandardTools } from './tools.ts';

// Executable entry vendor-CLI transports point their MCP config at. Importing this file starts
// the server on stdio, so only spawn it — never import it from library code.
// Dev invocation:   node --conditions=docstube-source packages/agent-runtime/src/mcp-stdio-server-bin.ts
// Built invocation: node packages/agent-runtime/dist/mcp-stdio-server-bin.mjs
//
// Observed reads cross the process boundary through the JSONL sink file named by
// DOCSTUBE_MCP_OBSERVED_READS_FILE; the spawning transport reads it back after the session.

const repoRoot = process.env[mcpServerEnvVars.repoRoot] ?? process.cwd();
const readRootsRaw = process.env[mcpServerEnvVars.readRoots];
const readRoots = readRootsRaw ? (JSON.parse(readRootsRaw) as string[]) : ['.'];
const sinkFile = process.env[mcpServerEnvVars.observedReadsFile];
const observedReads = createObservedReadsCollector(
  sinkFile ? (read) => appendFileSync(sinkFile, `${JSON.stringify(read)}\n`) : undefined
);

const extraToolsFile = process.env[mcpServerEnvVars.extraToolsFile];
const toolCallsFile = process.env[mcpServerEnvVars.toolCallsFile];
const forwarded =
  extraToolsFile && toolCallsFile
    ? await loadForwardedToolImplementations(extraToolsFile, (line) => appendFileSync(toolCallsFile, `${line}\n`))
    : [];

void runMcpStdioServer({ tools: [...createStandardTools({ repoRoot, readRoots, observedReads }), ...forwarded] });
