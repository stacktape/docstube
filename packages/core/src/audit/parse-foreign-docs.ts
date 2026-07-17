import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PageEntity } from '@docstube/contracts';
import { extractPageEntity } from '../entities/extract-entities.ts';

// Foreign docs (Mintlify/Docusaurus/GitBook exports, plain md/mdx trees) get the same entity
// trees our own output gets (ARCHITECTURE.md §13 row 5: audit shares the claim schema). Parsing
// is best-effort: foreign markdown is not always valid MDX, and a file we cannot parse is
// reported as skipped — never silently dropped (never silently wrong applies to audit too).

const skippedDirectories = new Set(['node_modules', 'dist', 'build', 'coverage', '.docstube', '.git']);
const docExtensions = ['.md', '.mdx'];

export type ForeignDocPage = {
  // docsDir-relative POSIX path — the `file` every defect cites.
  file: string;
  page: PageEntity;
  markdown: string;
};

export type ParseForeignDocsResult = {
  pages: ForeignDocPage[];
  skipped: Array<{ file: string; reason: string }>;
};

const walkDocFiles = async (docsDir: string): Promise<string[]> => {
  const results: string[] = [];
  const visit = async (relativeDir: string): Promise<void> => {
    const absoluteDir = relativeDir === '' ? docsDir : join(docsDir, relativeDir);
    const entries = await readdir(absoluteDir, { withFileTypes: true });
    const subdirectories: string[] = [];
    for (const entry of entries) {
      const relativePath = relativeDir === '' ? entry.name : `${relativeDir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || skippedDirectories.has(entry.name)) {
          continue;
        }
        subdirectories.push(relativePath);
      } else if (entry.isFile() && docExtensions.some((extension) => entry.name.endsWith(extension))) {
        results.push(relativePath);
      }
    }
    await Promise.all(subdirectories.map(visit));
  };
  await visit('');
  return results.toSorted();
};

// Foreign paths carry uppercase/underscores/dots; normalize each segment into our slug charset.
export const slugFromDocPath = (relativePath: string): string =>
  relativePath
    .replace(/\.(md|mdx)$/u, '')
    .split('/')
    .map(
      (segment) =>
        segment
          .toLowerCase()
          .replace(/[^a-z0-9]+/gu, '-')
          .replace(/^-+|-+$/gu, '') || 'page'
    )
    .join('/');

export const parseForeignDocs = async (options: { docsDir: string }): Promise<ParseForeignDocsResult> => {
  const files = await walkDocFiles(options.docsDir);
  const pages: ForeignDocPage[] = [];
  const skipped: Array<{ file: string; reason: string }> = [];
  for (const file of files) {
    // The read sits inside the try: one unreadable file is a skipped page, never an aborted audit.
    try {
      const markdown = await readFile(join(options.docsDir, file), 'utf8');
      const page = extractPageEntity({ mdx: markdown, slug: slugFromDocPath(file), fallbackTitle: file });
      pages.push({ file, page, markdown });
    } catch (error) {
      skipped.push({ file, reason: (error as Error).message });
    }
  }
  return { pages, skipped };
};
