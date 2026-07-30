import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { FingerprintSnapshot } from '@docstube/contracts';
import { buildFingerprintSnapshot } from '@docstube/codemap';
import { loadConfigFamily } from '../config/config-io.ts';
import { createPluginHost } from '../plugins/plugin-host.ts';
import { loadConfiguredPlugins, registerBuiltinPlugins } from '../plugins/load-plugins.ts';
import { resolveSourceRevision } from '../pipeline/generate.ts';

// The answer surfaces (CLI, local UI, later the Action's `/answer` ingestion) must stamp a fact
// with the answer-time revision fingerprint of its subject, and they run outside a pipeline run
// where no snapshot exists. Building one costs a deterministic parse — no agent calls — so it is
// LAZY: nothing is built unless there is actually an answered flag to commit.
export const createFingerprintResolver = (repoRoot: string): (() => Promise<FingerprintSnapshot>) => {
  let pending: Promise<FingerprintSnapshot> | undefined;
  const build = async (): Promise<FingerprintSnapshot> => {
    const family = await loadConfigFamily(repoRoot);
    const host = createPluginHost();
    await registerBuiltinPlugins(host);
    await loadConfiguredPlugins(host, family.config, repoRoot);
    const { commit } = await resolveSourceRevision(repoRoot);
    return buildFingerprintSnapshot({
      repoRoot,
      commit,
      packs: host.languagePacks().map((entry) => entry.definition)
    });
  };
  return () => (pending ??= build());
};

const run = promisify(execFile);

// Real attribution, not a role label: the answering human's git identity when the repository has
// one. `<surface>:<identity>` mirrors the `github:someuser` shape the contract documents.
export const resolveAnswerAuthor = async (repoRoot: string, surface: 'cli' | 'local-ui'): Promise<string> => {
  for (const key of ['user.email', 'user.name']) {
    try {
      const { stdout } = await run('git', ['config', '--get', key], { cwd: repoRoot });
      const identity = stdout.trim();
      if (identity !== '') {
        return `${surface}:${identity}`;
      }
    } catch {
      // No git, no repository, or no configured identity — fall through to the bare surface.
    }
  }
  return surface;
};
