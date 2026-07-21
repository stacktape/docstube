import { createManifestStore, loadConfigFamily, CoreError } from '@docstube/core';
import type { PageShard } from '@docstube/contracts';
import type { CliCommandResult, CliOutput } from '../cli-output.ts';

// Status reads the canonical trust spine (the shard's ClaimEvidence records): the page badge
// answers "is every ledger claim checked?" and the counts show the literal denominator
// (trust-model-v2 decision 2). The legacy proven/scored block ladder is gone.

type ClaimCounts = { checked: number; unchecked: number; contradicted: number; total: number };

const claimCounts = (shard: PageShard): ClaimCounts => {
  const records = shard.provenance?.claimEvidence ?? [];
  return {
    checked: records.filter((record) => record.correctness === 'checked').length,
    unchecked: records.filter((record) => record.correctness === 'unchecked').length,
    contradicted: records.filter((record) => record.correctness === 'contradicted').length,
    total: records.length
  };
};

const pageLine = (counts: ClaimCounts): string => {
  if (counts.total === 0) {
    return 'no claims';
  }
  const parts = [`${counts.checked}/${counts.total} claims checked`];
  if (counts.contradicted > 0) {
    parts.push(`${counts.contradicted} CONTRADICTED`);
  }
  return parts.join(' · ');
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
  const totals = { verifiedPages: 0, checked: 0, contradicted: 0, total: 0 };
  for (const entry of index.pages) {
    const shard = await store.readPageShard({ locale: sourceLocale, pageId: entry.id });
    if (shard === undefined) {
      output.info(`  ${entry.slug} — shard missing (state corrupt? run generate)`);
      continue;
    }
    openFlags += shard.flags.filter((flag) => flag.status === 'open').length;
    const counts = claimCounts(shard);
    const verified = counts.total > 0 && counts.checked === counts.total;
    if (verified) {
      totals.verifiedPages += 1;
    }
    totals.checked += counts.checked;
    totals.contradicted += counts.contradicted;
    totals.total += counts.total;
    output.info(
      `  ${entry.slug} — ${verified ? 'verified' : 'partial'} · ${pageLine(counts)}${shard.flags.length > 0 ? ` · ${shard.flags.length} flag(s)` : ''}`
    );
  }
  output.info(
    `claims: ${totals.checked}/${totals.total} checked · ${totals.contradicted} contradicted · verified pages: ${totals.verifiedPages}/${index.pages.length} · open flags: ${openFlags}`
  );
  return { exitCode: 0 };
};
