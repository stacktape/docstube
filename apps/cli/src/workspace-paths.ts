import { readdir, rm, stat } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';

export const pathExists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

export const stateFiles = (workspaceDir: string): string[] => [
  join(workspaceDir, '.docstube', 'db.sqlite'),
  join(workspaceDir, '.docstube', 'db.sqlite-shm'),
  join(workspaceDir, '.docstube', 'db.sqlite-wal')
];

export const deleteMachineState = async (workspaceDir: string): Promise<void> => {
  await Promise.all(stateFiles(workspaceDir).map((file) => rm(file, { force: true })));
};

export const manifestPath = (workspaceDir: string): string => join(workspaceDir, '.docstube', 'manifest.yml');

export const telemetryPath = (workspaceDir: string): string => join(workspaceDir, '.docstube', 'telemetry.json');

export const toRelativePath = (workspaceDir: string, file: string): string => {
  const candidate = relative(workspaceDir, file).replaceAll('\\', '/');
  return candidate && !candidate.startsWith('..') && !candidate.startsWith('/') ? candidate : basename(file);
};

export const listFilesRecursive = async (root: string, extensions: readonly string[]): Promise<string[]> => {
  if (!(await pathExists(root))) {
    return [];
  }

  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry.name);
      if (entry.isDirectory()) {
        return listFilesRecursive(path, extensions);
      }

      return extensions.some((extension) => entry.name.endsWith(extension)) ? [path] : [];
    })
  );

  return files.flat().toSorted();
};
