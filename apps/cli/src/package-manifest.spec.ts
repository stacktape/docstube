import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { docstubeVersion as kernelVersion } from '@docstube/core';
import { describe, expect, it } from 'vitest';
import { docstubeVersion as cliVersion } from './cli-version.ts';

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

  // `docstube version`, the telemetry event, and the kernel must all report one version.
  // scripts/release/set-version.ts rewrites both source constants; this fails when it misses one,
  // which it silently did after `packages/core/src/core.ts` became a re-export of `version.ts`.
  it('reports the same version from the CLI, the kernel, and the published manifest', async () => {
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as { version?: string };
    expect({ cli: cliVersion, kernel: kernelVersion }).toEqual({
      cli: packageJson.version,
      kernel: packageJson.version
    });
  });
});
