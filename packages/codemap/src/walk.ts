import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

// Directories that never contain documentable source, skipped at any depth. Hidden directories
// (leading dot) are skipped by a separate rule, which already covers `.git` and `.docstube`.
const skippedDirectories = new Set(['node_modules', 'dist', 'build', 'coverage', '.docstube', '.git']);

export type WalkOptions = {
  repoRoot: string;
  // File extensions to collect, with the leading dot: ['.ts', '.tsx']. Absent = every file (the
  // fingerprint whole-file fallback needs the full tree, not one pack's slice).
  extensions?: string[];
  // Repo-relative POSIX paths (exact files or directory prefixes) to skip, e.g. ['test-fixtures'].
  ignore?: string[];
};

const isIgnored = (relativePath: string, ignore: string[]): boolean =>
  ignore.some((entry) => relativePath === entry || relativePath.startsWith(`${entry}/`));

// Walks the repo and returns matching files as sorted repo-relative POSIX paths (the manifest
// never stores absolute or Windows-style paths — see repoPathSchema in @docstube/contracts).
export const walkRepoFiles = async (options: WalkOptions): Promise<string[]> => {
  const ignore = options.ignore ?? [];
  const results: string[] = [];
  const visit = async (relativeDir: string): Promise<void> => {
    const absoluteDir = relativeDir === '' ? options.repoRoot : join(options.repoRoot, relativeDir);
    const entries = await readdir(absoluteDir, { withFileTypes: true });
    const subdirectories: string[] = [];
    for (const entry of entries) {
      const relativePath = relativeDir === '' ? entry.name : `${relativeDir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || skippedDirectories.has(entry.name) || isIgnored(relativePath, ignore)) {
          continue;
        }
        subdirectories.push(relativePath);
      } else if (entry.isFile()) {
        if (isIgnored(relativePath, ignore)) {
          continue;
        }
        if (
          options.extensions === undefined ||
          options.extensions.some((extension) => entry.name.endsWith(extension))
        ) {
          results.push(relativePath);
        }
      }
    }
    await Promise.all(subdirectories.map(visit));
  };
  await visit('');
  return results.toSorted();
};
