import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Document } from 'yaml';
import { parseDocument } from 'yaml';
import type { DocstubeConfig, DocstubeConfigInput, Ia } from '@docstube/contracts';
import { docstubeConfigSchema, iaSchema } from '@docstube/contracts';
import { CoreError, configError } from '../errors.ts';
import type { YamlPath } from './config-io.ts';
import { configFileNames, editYamlDocument, parseDocstubeConfig } from './config-io.ts';

// Wizard write-back (PRODUCT §3.9.5 hard requirement): every programmatic edit of the config
// family goes through the `yaml` Document API so hand-written comments and formatting survive.
// Writes are atomic at the validation boundary — an edit that would produce an invalid file is
// rejected before anything touches disk.

export type ConfigValueUpdate = { path: YamlPath; value: unknown };

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const formatIssues = (issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): string =>
  issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('\n  ');

// Batched comment-preserving update: one read, every setIn applied to the same Document, one
// write — and only after the RESULT parses as a valid config. Invalid edits reject atomically.
export const updateConfigValues = async (repoRoot: string, updates: ConfigValueUpdate[]): Promise<DocstubeConfig> => {
  const path = join(repoRoot, configFileNames.config);
  let source: string;
  try {
    source = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new CoreError(
        'config-missing',
        `${configFileNames.config} not found — run \`docstube wizard\` to create it`,
        { repoRoot }
      );
    }
    throw error;
  }
  const next = editYamlDocument(source, (doc) => {
    for (const update of updates) {
      doc.setIn([...update.path], update.value);
    }
  });
  const parsed = parseDocstubeConfig(next);
  await writeFile(path, next, 'utf8');
  return parsed;
};

// Full-document write for ia.yml: NavTree edits replace the whole tree, so this rebuilds the
// document from the validated structure. The document-level header comment (scaffold banner or a
// hand-written note above the first key) is carried over; per-node comments inside a replaced
// tree cannot survive a structural rewrite by design.
export const writeIaFile = async (repoRoot: string, ia: Ia): Promise<Ia> => {
  const result = iaSchema.safeParse(ia);
  if (!result.success) {
    throw configError(`refusing to write an invalid ${configFileNames.ia}:\n  ${formatIssues(result.error.issues)}`, {
      fileName: configFileNames.ia
    });
  }
  const path = join(repoRoot, configFileNames.ia);
  const existing = (await fileExists(path)) ? await readFile(path, 'utf8') : undefined;
  const doc = existing === undefined ? new Document() : parseDocument(existing);
  // A top-of-file comment can live on the document, the root node, or the first map key
  // (depending on blank lines) — rescue it from whichever spot the parser chose.
  type CommentedNode = { commentBefore?: string | null };
  const rootNode = doc.contents as (CommentedNode & { items?: Array<{ key?: CommentedNode | null }> }) | null;
  const previousHeader = doc.commentBefore ?? rootNode?.commentBefore ?? rootNode?.items?.[0]?.key?.commentBefore;
  const contents = doc.createNode(result.data);
  if (previousHeader != null) {
    (contents as { commentBefore?: string }).commentBefore = previousHeader;
  }
  doc.contents = contents;
  await writeFile(path, doc.toString(), 'utf8');
  return result.data;
};

export type ConfigFamilySeed = {
  // The wizard seeds this from the detection engine + persona picks; defaults stay implicit so
  // the written file carries intent only.
  config: DocstubeConfigInput;
  ia: Ia;
};

export type ScaffoldResult = { configPath: string; iaPath: string };

const documentWithHeader = (value: unknown, header: string): string => {
  const doc = new Document();
  const contents = doc.createNode(value);
  (contents as { commentBefore?: string }).commentBefore = header;
  doc.contents = contents;
  return doc.toString();
};

const configHeader = [
  ' docstube.yml — docs intent for this repository (created by the docstube wizard).',
  ' Edit freely: docstube preserves your comments and formatting on every write.',
  ' Docs: https://docstube.dev/config'
].join('\n');

const iaHeader = [
  ' ia.yml — the documentation information architecture (created by the docstube wizard).',
  ' Each node with a `brief` becomes a page; nodes without one are pure grouping nodes.'
].join('\n');

// Create-only write: the 'wx' flag makes the no-overwrite guarantee atomic — a config created
// between an existence check and this write is never clobbered.
const writeNewFile = async (path: string, content: string): Promise<void> => {
  try {
    await writeFile(path, content, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw configError(`refusing to overwrite existing ${path} — edit it via the wizard or by hand instead`, {
        path
      });
    }
    throw error;
  }
};

// First-run scaffold: creates docstube.yml + ia.yml. Refuses to overwrite — existing files are
// user-owned and must only ever be edited through the comment-preserving paths above.
export const scaffoldConfigFamily = async (repoRoot: string, seed: ConfigFamilySeed): Promise<ScaffoldResult> => {
  const configResult = docstubeConfigSchema.safeParse(seed.config);
  if (!configResult.success) {
    throw configError(
      `refusing to scaffold an invalid ${configFileNames.config}:\n  ${formatIssues(configResult.error.issues)}`,
      {
        fileName: configFileNames.config
      }
    );
  }
  const iaResult = iaSchema.safeParse(seed.ia);
  if (!iaResult.success) {
    throw configError(
      `refusing to scaffold an invalid ${configFileNames.ia}:\n  ${formatIssues(iaResult.error.issues)}`,
      {
        fileName: configFileNames.ia
      }
    );
  }
  const configPath = join(repoRoot, configFileNames.config);
  const iaPath = join(repoRoot, configFileNames.ia);
  for (const path of [configPath, iaPath]) {
    if (await fileExists(path)) {
      throw configError(`refusing to overwrite existing ${path} — edit it via the wizard or by hand instead`, {
        path
      });
    }
  }
  // Write the raw seed (intent only), not the defaults-expanded parse result. The existence check
  // above only makes the common case fail before the first byte lands; writeNewFile is the guard.
  await writeNewFile(configPath, documentWithHeader(seed.config, configHeader));
  await writeNewFile(iaPath, documentWithHeader(seed.ia, iaHeader));
  return { configPath, iaPath };
};
