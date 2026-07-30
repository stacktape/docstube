import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

// Test-only helper (never imported by shipped code): a byte-level snapshot of everything a publish
// is allowed to touch — the committed manifest and the generated site — so "the published tree is
// unchanged" can be asserted as an equality rather than a handful of spot checks.
// `.docstube/staging/`, `.docstube/runs/` and `.docstube/cache/` are deliberately excluded: they are
// machine-local, and staged work CHANGING is precisely what a frozen run is supposed to do.

const walk = async (root: string, prefix: string, into: Map<string, string>): Promise<void> => {
  let entries;
  try {
    entries = await readdir(join(root, prefix), { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const relativePath = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      await walk(root, relativePath, into);
    } else if (entry.isFile()) {
      into.set(relativePath, await readFile(join(root, relativePath), 'utf8'));
    }
  }
};

export const snapshotPublishedTree = async (
  repoRoot: string,
  outDir = 'docs-site'
): Promise<Record<string, string>> => {
  const files = new Map<string, string>();
  await walk(repoRoot, '.docstube/manifest', files);
  await walk(repoRoot, outDir, files);
  return Object.fromEntries([...files].toSorted(([left], [right]) => left.localeCompare(right)));
};
