import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Belt-and-braces fallback list, used when git cannot answer (see gitVisibleTree). Directories that
// never contain documentable source, skipped at any depth. Hidden directories (leading dot) are
// skipped by a separate rule, which already covers `.git` and `.docstube`. Kept even when git DOES
// answer: a repo may simply not gitignore node_modules, and these are never documentation source.
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

// The set of paths git would version, plus every directory on the way to one.
type GitVisibleTree = { files: Set<string>; directories: Set<string> };

// GITIGNORED PATHS ARE NOT DOCUMENTATION SOURCE. Build output, caches and local artifacts must not
// be walked: a generation run against this repo scanned 58 files of a nested app's bundled output
// (`apps/cli/local-ui/**`, gitignored), which both invited docs about build artifacts and — because
// unversioned reads mark a run uncommitted — made the complete badge unreachable in any repo with
// gitignored build output.
//
// ONE bounded git call, never a probe per file. The ALLOWLIST form (`--cached --others
// --exclude-standard` = tracked + untracked-but-not-ignored, i.e. exactly the files git would
// version) is used rather than the denylist form (`--others --ignored`) for two reasons: its output
// is bounded by the repo's real file count instead of by the size of node_modules, and anything git
// hides for ANY reason — nested ignored build output at any depth, `.git/info/exclude`, the global
// excludes file — is simply absent from the allowlist rather than needing to be enumerated.
//
// Consequences worth knowing: files inside submodules are not listed by the superproject, so they
// are excluded (they are versioned in their own repository, not this one); and an index-only path
// deleted from disk cannot match a readdir entry, so it drops out harmlessly.
//
// Returns undefined when git is unavailable, when `repoRoot` is not inside a repository, or when git
// reports NOTHING visible — callers then fall back to skippedDirectories alone. Never throws, never
// yields an empty file set.
//
// The empty-result guard is not paranoia: `repoRoot` is often a directory an OUTER repository
// ignores (the dogfood build points the codemap at `dist-dogfood/workspace`, and generated or
// scratch workspaces behave the same). Everything under such a root is ignored from the outer
// repo's point of view, so honouring the empty answer would silently document nothing. A repo where
// genuinely every file is ignored degrades to the pre-git behaviour, which is no worse than before.
const gitVisibleTree = async (repoRoot: string): Promise<GitVisibleTree | undefined> => {
  try {
    // -z: NUL-separated and never quoted, so paths with spaces/UTF-8 survive verbatim. Run from
    // repoRoot, git lists paths relative to it — the same shape this walk produces.
    const { stdout } = await execFileAsync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      cwd: repoRoot,
      maxBuffer: 256 * 1024 * 1024
    });
    const files = new Set(stdout.split('\0').filter((path) => path !== ''));
    if (files.size === 0) {
      return undefined;
    }
    const directories = new Set<string>();
    for (const file of files) {
      for (let index = file.indexOf('/'); index !== -1; index = file.indexOf('/', index + 1)) {
        directories.add(file.slice(0, index));
      }
    }
    return { files, directories };
  } catch {
    return undefined;
  }
};

// Walks the repo and returns matching files as sorted repo-relative POSIX paths (the manifest
// never stores absolute or Windows-style paths — see repoPathSchema in @docstube/contracts).
// Gitignored paths are excluded whenever git can say what it versions.
export const walkRepoFiles = async (options: WalkOptions): Promise<string[]> => {
  const ignore = options.ignore ?? [];
  const visible = await gitVisibleTree(options.repoRoot);
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
        // A directory holding no git-visible file is entirely ignored: never descend into it.
        if (visible !== undefined && !visible.directories.has(relativePath)) {
          continue;
        }
        subdirectories.push(relativePath);
      } else if (entry.isFile()) {
        if (isIgnored(relativePath, ignore) || (visible !== undefined && !visible.files.has(relativePath))) {
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
