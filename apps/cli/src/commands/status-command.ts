import { createManifestStore, loadConfigFamily, CoreError } from '@docstube/core';
import type { PageShard } from '@docstube/contracts';
import type { CliCommandResult, CliOutput } from '../cli-output.ts';

// The page badge answers "is everything provable here proven?"; the block distribution answers
// "how much IS provable?" — both matter, so status shows badge + distribution.
const blockDistribution = (shard: PageShard): string => {
  const blocks = [...shard.page.preamble, ...shard.page.sections.flatMap((section) => section.blocks)];
  const provable = blocks.filter((block) => block.blockType === 'code-example' || block.claims.length > 0);
  const proven = provable.filter((block) => block.guarantee === 'proven').length;
  return provable.length === 0 ? 'nothing provable' : `${proven}/${provable.length} provable blocks proven`;
};

export type StatusCommandInput = {
  workspaceDir: string;
};

export const runStatusCommand = async (input: StatusCommandInput, output: CliOutput): Promise<CliCommandResult> => {
  let currentVersion = 'latest';
  let sourceLocale = 'en';
  try {
    const family = await loadConfigFamily(input.workspaceDir);
    currentVersion = family.config.versions.current;
    sourceLocale = family.config.locales.source;
  } catch (error) {
    if (!(error instanceof CoreError)) {
      throw error;
    }
    output.error(error.message);
    return { exitCode: 1 };
  }

  const store = createManifestStore(input.workspaceDir, currentVersion);
  const index = await store.readIndex();
  if (index === undefined) {
    output.info('No manifest yet — run `docstube generate` first.');
    return { exitCode: 0 };
  }

  output.info(`docs version ${currentVersion} · locales: ${index.locales.join(', ')} · ${index.pages.length} page(s)`);
  let openFlags = index.systemFlags.filter((flag) => flag.status === 'open').length;
  const guaranteeCounts = { proven: 0, scored: 0, 'out-of-domain': 0 };
  for (const entry of index.pages) {
    const shard = await store.readPageShard({ locale: sourceLocale, pageId: entry.id });
    if (shard === undefined) {
      output.info(`  ${entry.slug} — shard missing (state corrupt? run generate)`);
      continue;
    }
    openFlags += shard.flags.filter((flag) => flag.status === 'open').length;
    guaranteeCounts[shard.page.guarantee] += 1;
    output.info(
      `  ${entry.slug} — ${shard.page.guarantee} · ${blockDistribution(shard)}${shard.flags.length > 0 ? ` · ${shard.flags.length} flag(s)` : ''}`
    );
  }
  output.info(
    `guarantees: ${guaranteeCounts.proven} proven · ${guaranteeCounts.scored} scored · ${guaranteeCounts['out-of-domain']} out-of-domain · open flags: ${openFlags}`
  );
  return { exitCode: 0 };
};
