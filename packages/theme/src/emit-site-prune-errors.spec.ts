import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// STALE ROUTES MUST NEVER BE SILENTLY UNREPORTED (impl-24 finding). The prune walk swallowed EVERY
// readdir failure, not only ENOENT ("the tree does not exist yet"). An unreadable directory —
// EACCES, EPERM, a path replaced by a file — meant the reconciler could not see part of the route
// tree, yet emission still reported a clean prune. This spec owns the failing-readdir path, so it
// mocks node:fs/promises for its own module graph only.
const state = vi.hoisted(() => ({ failingSegment: '' }));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readdir: (path: Parameters<typeof actual.readdir>[0], options?: Parameters<typeof actual.readdir>[1]) => {
      if (state.failingSegment !== '' && String(path).includes(state.failingSegment)) {
        return Promise.reject(Object.assign(new Error('permission denied'), { code: 'EACCES' }));
      }
      return (actual.readdir as (...args: unknown[]) => Promise<unknown>)(path, options);
    }
  };
});

const { emitSite } = await import('./emit-site.ts');
const { buildFixtureInput } = await import('./emit-site-fixture.ts');

describe('route prune error reporting', () => {
  it('surfaces a non-ENOENT readdir failure as an emit warning naming the path', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'docstube-theme-prune-error-'));
    await emitSite(buildFixtureInput(repoRoot));

    state.failingSegment = join('src', 'pages');
    try {
      const result = await emitSite(buildFixtureInput(repoRoot));
      const warning = result.warnings.find((entry) => entry.includes('EACCES'));
      expect(warning).toBeDefined();
      expect(warning).toContain(`${repoRoot}${sep}docs-site${sep}src${sep}pages`);
      expect(warning).toContain('stale routes under it may still be served');
      // The unreadable tree yields no prunes — which is exactly why the failure has to be reported.
      expect(result.pruned).toEqual([]);
    } finally {
      state.failingSegment = '';
    }
  });

  it('stays silent when the route tree simply does not exist yet (ENOENT)', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'docstube-theme-prune-enoent-'));
    const result = await emitSite(buildFixtureInput(repoRoot));
    expect(result.warnings).toEqual([]);
    expect(result.pruned).toEqual([]);
  });
});
