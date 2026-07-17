import { execFile } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { existsSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { promisify } from 'node:util';
import { CoreError, loadConfigFamily } from '@docstube/core';
import type { CliCommandResult, CliOutput } from '../cli-output.ts';

const execFileAsync = promisify(execFile);

// `docstube preview`: build (only when stale) and serve the emitted site. The built site is plain
// static HTML, so serving needs nothing but this process — npm is involved only when a rebuild is
// actually due. One command from "generated" to "looking at it".

export type PreviewCommandInput = {
  workspaceDir: string;
  port?: number | undefined;
  // Force a rebuild even when dist looks fresh.
  build?: boolean | undefined;
  // Test seam: skip opening the browser / blocking forever.
  openBrowser?: boolean | undefined;
};

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.wasm': 'application/wasm',
  '.xml': 'application/xml'
};

// URL path -> file inside dist, directory-style routing like the production host would do.
export const resolveStaticFile = (distDir: string, urlPath: string): string | undefined => {
  const decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  const safe = normalize(decoded).replace(/^([/\\])+/, '');
  const resolved = join(distDir, safe);
  // normalize() collapses any ../ — anything trying to climb out lands outside distDir.
  if (resolved !== distDir && !resolved.startsWith(distDir + sep)) {
    return undefined;
  }
  const candidates = decoded.endsWith('/')
    ? [join(resolved, 'index.html')]
    : [resolved, join(resolved, 'index.html'), `${resolved}.html`];
  return candidates.find((candidate) => existsSync(candidate) && !existsSync(join(candidate, 'index.html')));
};

export const createStaticHandler =
  (distDir: string) =>
  async (urlPath: string): Promise<{ status: number; contentType: string; body: Buffer | string }> => {
    const filePath = resolveStaticFile(distDir, urlPath);
    if (filePath === undefined) {
      const notFound = join(distDir, '404.html');
      return {
        status: 404,
        contentType: 'text/html; charset=utf-8',
        body: existsSync(notFound) ? await readFile(notFound) : '404 — not found'
      };
    }
    return {
      status: 200,
      contentType: MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      body: await readFile(filePath)
    };
  };

const newestMtime = async (dir: string): Promise<number> => {
  let newest = 0;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) {
      continue;
    }
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, await newestMtime(path));
    } else {
      try {
        newest = Math.max(newest, (await stat(path)).mtimeMs);
      } catch {
        // Deleted between readdir and stat — irrelevant for staleness.
      }
    }
  }
  return newest;
};

// Stale when dist is missing or ANY site source/content file is newer than the built entry page.
export const distIsStale = async (siteDir: string): Promise<boolean> => {
  const marker = join(siteDir, 'dist', 'index.html');
  if (!existsSync(marker)) {
    return true;
  }
  const built = (await stat(marker)).mtimeMs;
  return (await newestMtime(siteDir)) > built;
};

const openInBrowser = (url: string): void => {
  const [command, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  // Best-effort: the printed URL is the contract, the auto-open is the courtesy.
  execFile(command as string, args as string[], () => {});
};

const buildSite = async (siteDir: string, output: CliOutput): Promise<void> => {
  if (!existsSync(join(siteDir, 'node_modules'))) {
    output.info('installing site dependencies (first preview only)…');
    await execFileAsync('npm', ['install', '--no-audit', '--no-fund'], {
      cwd: siteDir,
      shell: process.platform === 'win32',
      timeout: 300_000
    });
  }
  output.info('building the site…');
  await execFileAsync('npm', ['run', 'build'], {
    cwd: siteDir,
    shell: process.platform === 'win32',
    timeout: 300_000
  });
};

export const runPreviewCommand = async (input: PreviewCommandInput, output: CliOutput): Promise<CliCommandResult> => {
  let outDir = 'docs-site';
  try {
    const family = await loadConfigFamily(input.workspaceDir);
    outDir = family.config.outDir;
  } catch (error) {
    if (!(error instanceof CoreError)) {
      throw error;
    }
    // No valid config: still preview a docs-site/ if one exists (the site is self-contained).
  }
  const siteDir = join(input.workspaceDir, outDir);
  if (!existsSync(join(siteDir, 'package.json'))) {
    output.error(`no generated site at ${outDir}/ — run \`docstube generate\` first`);
    return { exitCode: 1 };
  }

  if (input.build === true || (await distIsStale(siteDir))) {
    try {
      await buildSite(siteDir, output);
    } catch (error) {
      output.error(`site build failed: ${error instanceof Error ? error.message : String(error)}`);
      return { exitCode: 1 };
    }
  }

  const distDir = join(siteDir, 'dist');
  const handler = createStaticHandler(distDir);
  const server: Server = createServer((request, response) => {
    void handler(request.url ?? '/').then(
      ({ status, contentType, body }) => {
        response.writeHead(status, { 'content-type': contentType, 'cache-control': 'no-cache' });
        response.end(body);
      },
      () => {
        response.writeHead(500, { 'content-type': 'text/plain' });
        response.end('internal error');
      }
    );
  });

  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(input.port ?? 0, '127.0.0.1', () => resolvePromise());
  }).catch((error: NodeJS.ErrnoException) => {
    output.error(
      error.code === 'EADDRINUSE' ? `port ${input.port} is already in use — pick another with --port` : error.message
    );
    server.close();
    throw error;
  });

  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : (input.port ?? 0);
  const url = `http://localhost:${port}/`;
  output.info(`docs preview running at ${url} — Ctrl+C to stop`);
  if (input.openBrowser !== false) {
    openInBrowser(url);
    // Serve until interrupted: the promise deliberately never resolves in interactive use.
    await new Promise<void>((resolvePromise) => {
      process.once('SIGINT', () => {
        server.close();
        resolvePromise();
      });
    });
    return { exitCode: 0 };
  }
  // Test seam: hand the caller a running server to probe and close.
  return { exitCode: 0, server, url } as CliCommandResult & { server: Server; url: string };
};
