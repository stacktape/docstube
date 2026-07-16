import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

// Durable, shared learning (PRODUCT §3.3): the feedback categorizer writes criteria and writing
// instructions as committed markdown files; the writer and reviewers read them on every future
// generation. Missing directories simply mean "no learned context yet".

const readMarkdownDir = async (dir: string): Promise<string[]> => {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  const files = entries.filter((name) => name.endsWith('.md')).toSorted();
  return Promise.all(files.map((name) => readFile(join(dir, name), 'utf8')));
};

export type ContextFiles = {
  criteria: string[];
  instructions: string[];
};

export const loadContextFiles = async (repoRoot: string): Promise<ContextFiles> => {
  const [criteria, instructions] = await Promise.all([
    readMarkdownDir(join(repoRoot, '.docstube', 'criteria')),
    readMarkdownDir(join(repoRoot, '.docstube', 'instructions'))
  ]);
  return { criteria, instructions };
};
