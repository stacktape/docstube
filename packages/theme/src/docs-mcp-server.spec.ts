import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emitSite } from './emit-site.ts';
import { buildFixtureInput } from './emit-site-fixture.ts';

// Exercises the emitted docs MCP server for real: emit a fixture site, spawn `node` on the
// emitted script, and speak Streamable HTTP (JSON-RPC 2.0 over POST) to 127.0.0.1 only.

const startServer = (scriptPath: string): Promise<{ child: ChildProcess; url: string }> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`docs-mcp-server did not start in time. stdout: ${stdout} stderr: ${stderr}`));
    }, 15_000);
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
      const match = /listening on (http:\/\/127\.0\.0\.1:\d+)/u.exec(stdout);
      if (match?.[1] !== undefined) {
        clearTimeout(timer);
        resolve({ child, url: match[1] });
      }
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`docs-mcp-server exited early (code ${code}). stderr: ${stderr}`));
    });
  });

type JsonRpcResponse = {
  jsonrpc: '2.0';
  id: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
};

describe('emitted docs-mcp-server', () => {
  let child: ChildProcess | undefined;
  let url = '';
  let nextId = 0;

  const rpc = async (method: string, params?: unknown): Promise<JsonRpcResponse> => {
    nextId += 1;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: nextId, method, ...(params === undefined ? {} : { params }) })
    });
    expect(response.status).toBe(200);
    return (await response.json()) as JsonRpcResponse;
  };

  beforeAll(async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'docstube-theme-mcp-'));
    await emitSite(buildFixtureInput(repoRoot));
    const started = await startServer(join(repoRoot, 'docs-site/mcp/docs-mcp-server.mjs'));
    child = started.child;
    url = started.url;
    child.removeAllListeners('exit');
  }, 30_000);

  afterAll(() => {
    child?.kill();
  });

  it('answers initialize with tools capability and server info', async () => {
    const response = await rpc('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'vitest', version: '0' }
    });
    expect(response.error).toBeUndefined();
    expect(response.result?.protocolVersion).toBe('2025-03-26');
    expect(response.result?.capabilities).toEqual({ tools: {} });
    const serverInfo = response.result?.serverInfo as { name: string } | undefined;
    expect(serverInfo?.name).toBe('docstube-docs-mcp');
  });

  it('acknowledges notifications with 202 and no body', async () => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
    });
    expect(response.status).toBe(202);
    expect(await response.text()).toBe('');
  });

  it('lists the three DeepWiki-convention tools', async () => {
    const response = await rpc('tools/list');
    const tools = response.result?.tools as Array<{ name: string; inputSchema: unknown }>;
    expect(tools.map((tool) => tool.name)).toEqual(['read_wiki_structure', 'read_wiki_contents', 'ask_question']);
    for (const tool of tools) {
      expect(tool.inputSchema).toBeDefined();
    }
  });

  it('read_wiki_structure returns the page tree from site-index.json', async () => {
    const response = await rpc('tools/call', { name: 'read_wiki_structure', arguments: {} });
    const content = response.result?.content as Array<{ type: string; text: string }>;
    expect(content[0]?.text).toContain('# Fixture Docs');
    expect(content[0]?.text).toContain('slug: getting-started/installation');
    expect(content[0]?.text).toContain('slug: guides/setup');
  });

  it('read_wiki_contents returns raw markdown from the public mirrors', async () => {
    const response = await rpc('tools/call', {
      name: 'read_wiki_contents',
      arguments: { page: 'guides/setup' }
    });
    const content = response.result?.content as Array<{ type: string; text: string }>;
    expect(content[0]?.text).toContain('Some setup prose.');

    const missing = await rpc('tools/call', { name: 'read_wiki_contents', arguments: { page: 'no/such-page' } });
    expect(missing.result?.isError).toBe(true);
  });

  it('ask_question returns the best keyword match and never fakes an AI answer', async () => {
    const response = await rpc('tools/call', {
      name: 'ask_question',
      arguments: { question: 'How do I install this?' }
    });
    const content = response.result?.content as Array<{ type: string; text: string }>;
    expect(content[0]?.text).toContain('not an AI-generated answer');
    expect(content[0]?.text).toContain('# Installation');
    expect(content[0]?.text).toContain('Install with npm.');
  });

  it('rejects unknown methods and unknown tools with JSON-RPC errors', async () => {
    const method = await rpc('resources/list');
    expect(method.error?.code).toBe(-32601);
    const tool = await rpc('tools/call', { name: 'write_wiki_contents', arguments: {} });
    expect(tool.error?.code).toBe(-32602);
  });
});

// The emitted server re-implements frontmatter stripping inline (it ships standalone into sites
// that cannot import @docstube/contracts), so it is the one place the canonical rules can drift.
// A strict rule here does not throw — it silently indexes frontmatter as prose.
describe('emitted docs-mcp-server with BOM/leading-blank frontmatter', () => {
  let child: ChildProcess | undefined;
  let url = '';
  let nextId = 100;

  const rpc = async (method: string, params?: unknown): Promise<JsonRpcResponse> => {
    nextId += 1;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: nextId, method, ...(params === undefined ? {} : { params }) })
    });
    expect(response.status).toBe(200);
    return (await response.json()) as JsonRpcResponse;
  };

  beforeAll(async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'docstube-theme-mcp-untidy-'));
    await emitSite(buildFixtureInput(repoRoot, { withUntidyFrontmatter: true }));
    const started = await startServer(join(repoRoot, 'docs-site/mcp/docs-mcp-server.mjs'));
    child = started.child;
    url = started.url;
    child.removeAllListeners('exit');
  }, 30_000);

  afterAll(() => {
    child?.kill();
  });

  it('never indexes a term that exists only in BOM-prefixed frontmatter', async () => {
    const response = await rpc('tools/call', { name: 'ask_question', arguments: { question: 'zzyzx' } });
    const content = response.result?.content as Array<{ type: string; text: string }>;
    expect(content[0]?.text).toContain('No page matched');
  });

  it('strips BOM-prefixed frontmatter out of the text it returns', async () => {
    const response = await rpc('tools/call', { name: 'ask_question', arguments: { question: 'setup prose' } });
    const content = response.result?.content as Array<{ type: string; text: string }>;
    expect(content[0]?.text).toContain('Some setup prose.');
    expect(content[0]?.text).not.toContain('Zzyzx');
    expect(content[0]?.text).not.toContain('description:');
  });
});
