import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageJsonPath = fileURLToPath(new URL('../package.json', import.meta.url));

describe('published CLI package manifest', () => {
  it('does not publish private workspace packages as runtime dependencies', async () => {
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as {
      dependencies?: Record<string, string>;
      files?: string[];
    };

    expect(Object.keys(packageJson.dependencies ?? {}).filter((name) => name.startsWith('@docstube/'))).toEqual([]);
    expect(packageJson.files).toEqual(expect.arrayContaining(['dist', 'local-ui']));
  });
});
