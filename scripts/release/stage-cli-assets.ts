import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const sourceDir = resolve('apps/local-ui/dist');
const targetDir = resolve('apps/cli/local-ui');

try {
  await stat(sourceDir);
} catch {
  throw new Error('Local UI build is missing. Run pnpm --filter @docstube/web-ui build first.');
}

await rm(targetDir, { recursive: true, force: true });
await mkdir(targetDir, { recursive: true });
await cp(sourceDir, targetDir, { recursive: true });
console.info(`Staged local UI assets at ${targetDir}.`);
