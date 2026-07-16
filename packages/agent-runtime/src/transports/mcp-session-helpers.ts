import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ObservedRead } from '@docstube/contracts';
import { parseObservedReadLines } from './claude-cli.ts';

// Shared plumbing for session transports that spawn a vendor CLI pointed at our MCP stdio server
// (codex-cli, google). claude-cli predates these helpers and keeps its own copies.

// Mirrors core's resolveMcpServerPath: the bin entry sits in src/ when running from TypeScript
// source (this file is src/transports/*.ts) and next to the bundled entry in dist/ when built.
export const resolveDefaultMcpServer = (): { serverPath: string; nodeArgs: string[] } => {
  const self = fileURLToPath(import.meta.url);
  return self.endsWith('.ts')
    ? { serverPath: join(self, '..', '..', 'mcp-stdio-server-bin.ts'), nodeArgs: ['--conditions=docstube-source'] }
    : { serverPath: join(self, '..', 'mcp-stdio-server-bin.mjs'), nodeArgs: [] };
};

// The MCP server (a separate process spawned by the vendor CLI) appends observed reads as JSONL
// to a sink file named through DOCSTUBE_MCP_OBSERVED_READS_FILE; a missing sink means no reads.
export const readObservedReadsSink = async (file: string): Promise<ObservedRead[]> => {
  try {
    return parseObservedReadLines(await readFile(file, 'utf8'));
  } catch {
    return [];
  }
};
