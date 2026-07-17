import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { materializeEmbeddedInspector, resolveInspectorPath } from './extract-symbols.ts';
import { pythonInspectorSource } from './python-inspector-source.ts';

const here = dirname(fileURLToPath(import.meta.url));

describe('python-inspector-source', () => {
  it('stays byte-identical to python-inspector.py (regenerate the embed when the script changes)', async () => {
    const onDisk = await readFile(join(here, 'python-inspector.py'), 'utf8');
    expect(pythonInspectorSource).toBe(onDisk.replace(/\r\n/g, '\n'));
  });

  it('materializes the embedded inspector into a stable content-addressed temp path', async () => {
    const first = await materializeEmbeddedInspector();
    try {
      expect(first.startsWith(tmpdir())).toBe(true);
      expect(first).toMatch(/docstube-python-inspector-[0-9a-f]{16}\.py$/);
      expect(await readFile(first, 'utf8')).toBe(pythonInspectorSource);
      // Write-once: a second call reuses the same path.
      expect(await materializeEmbeddedInspector()).toBe(first);
    } finally {
      await rm(first, { force: true });
    }
  });

  it('prefers the on-disk asset outside pkg snapshots', async () => {
    // In this repo the .py sits next to the module, so resolution must return it, not the embed.
    expect(await resolveInspectorPath()).toBe(join(here, 'python-inspector.py'));
  });
});
