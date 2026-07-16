import { open, readdir } from 'node:fs/promises';
import { join } from 'node:path';

// README extraction for the detection engine: title and project context are EXTRACTED verbatim,
// never generated (PRODUCT §3.9.2). Pure fs reads only.

const README_READ_BYTES = 16384;
const CONTEXT_MAX_LENGTH = 300;

export type ReadmeSignals = {
  title?: string | undefined;
  firstParagraph?: string | undefined;
};

export const readFileHead = async (absPath: string, maxBytes: number): Promise<string | undefined> => {
  let handle;
  try {
    handle = await open(absPath, 'r');
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } catch {
    return undefined;
  } finally {
    await handle?.close();
  }
};

const isBadgeLine = (line: string): boolean =>
  line.includes('![') && line.replace(/\[?!\[[^\]]*\]\([^)]*\)\]?(\([^)]*\))?/g, '').trim().length === 0;

const isProseLine = (line: string): boolean =>
  line !== '' &&
  !line.startsWith('#') &&
  !line.startsWith('>') &&
  !line.startsWith('<') &&
  !line.startsWith('|') &&
  !line.startsWith('---') &&
  !/^[-*+]\s/.test(line) &&
  !/^\d+\.\s/.test(line) &&
  !isBadgeLine(line);

const extractReadmeSignals = (text: string): ReadmeSignals => {
  let title: string | undefined;
  let paragraph: string | undefined;
  let inFence = false;
  const current: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith('```') || line.startsWith('~~~')) {
      inFence = !inFence;
      current.length = 0;
      continue;
    }
    if (inFence) {
      continue;
    }
    if (title === undefined) {
      const h1 = line.match(/^#\s+(.+?)\s*#*\s*$/);
      if (h1?.[1]) {
        title = h1[1];
        continue;
      }
    }
    if (paragraph === undefined) {
      if (isProseLine(line)) {
        current.push(line);
      } else if (current.length > 0) {
        paragraph = current.join(' ');
      }
    }
    if (title !== undefined && paragraph !== undefined) {
      break;
    }
  }
  if (paragraph === undefined && current.length > 0) {
    paragraph = current.join(' ');
  }
  return { title, firstParagraph: paragraph };
};

export const readReadmeSignals = async (repoRoot: string): Promise<ReadmeSignals> => {
  let entries;
  try {
    entries = await readdir(repoRoot, { withFileTypes: true });
  } catch {
    return {};
  }
  const readme = entries.find((entry) => entry.isFile() && /^readme(\.(md|markdown|txt))?$/i.test(entry.name));
  if (!readme) {
    return {};
  }
  const head = await readFileHead(join(repoRoot, readme.name), README_READ_BYTES);
  if (head === undefined) {
    return {};
  }
  return extractReadmeSignals(head);
};

export const clampContext = (text: string): string | undefined => {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length === 0) {
    return undefined;
  }
  if (collapsed.length <= CONTEXT_MAX_LENGTH) {
    return collapsed;
  }
  const cut = collapsed.slice(0, CONTEXT_MAX_LENGTH);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > CONTEXT_MAX_LENGTH * 0.66 ? cut.slice(0, lastSpace) : cut).trimEnd();
};
