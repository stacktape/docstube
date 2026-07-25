import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Document } from 'yaml';
import { parse, parseDocument } from 'yaml';
import type { z } from 'zod';
import type { DocstubeConfig, Glossary, Ia } from '@docstube/contracts';
import {
  docstubeConfigSchema,
  glossarySchema,
  iaSchema,
  localeRoutePrefixConflict,
  walkIaNodes
} from '@docstube/contracts';
import { CoreError, configError } from '../errors.ts';

// docstube.yml / ia.yml / glossary.yaml are user-owned typed YAML — intent only. Programmatic
// edits MUST go through the `yaml` Document API (comment- and formatting-preserving); a
// parse/serialize round trip would destroy hand annotations (PRODUCT §3.9.5 hard requirement).

export const configFileNames = {
  config: 'docstube.yml',
  ia: 'ia.yml',
  glossary: 'glossary.yaml'
} as const;

const parseWith = <T>(schema: z.ZodType<T>, text: string, fileName: string): T => {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (error) {
    throw configError(`${fileName} is not valid YAML: ${(error as Error).message}`, { fileName });
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`);
    throw configError(`${fileName} is invalid:\n  ${issues.join('\n  ')}`, { fileName, issues });
  }
  return result.data;
};

export const parseDocstubeConfig = (text: string): DocstubeConfig =>
  parseWith(docstubeConfigSchema, text, configFileNames.config);

export const parseIaFile = (text: string): Ia => parseWith(iaSchema, text, configFileNames.ia);

export const parseGlossaryFile = (text: string): Glossary => parseWith(glossarySchema, text, configFileNames.glossary);

const readOptional = async (path: string): Promise<string | undefined> => {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
};

// LOCALE-PREFIX SLUG COLLISION (impl-24 finding). ia.yml alone cannot see this: the collision only
// exists relative to docstube.yml's locales.targets, because renditions route under /<locale>/….
// A page slugged "de" (or any slug whose first segment is "de") with "de" configured would fight
// the German rendition for the same route, and the winner depends on write order. The pairing is
// rejected here — at IA load, the earliest point BOTH files are in hand — naming the page, the
// slug, and the locale, since only the author can decide which of the two to change.
const assertNoLocaleSlugCollisions = (config: DocstubeConfig, ia: Ia): void => {
  for (const node of walkIaNodes(ia.tree)) {
    if (node.brief === undefined && node.pageId === undefined) {
      continue; // a pure grouping node renders no page and claims no route
    }
    const locale = localeRoutePrefixConflict(node.slug, config.locales.targets);
    if (locale !== undefined) {
      throw configError(
        `${configFileNames.ia}: page "${node.title}" has slug "${node.slug}", which collides with the "${locale}" ` +
          `locale route namespace — translated pages are emitted under /${locale}/<slug>. Rename the slug, or ` +
          `remove "${locale}" from locales.targets in ${configFileNames.config}`,
        { fileName: configFileNames.ia, slug: node.slug, locale }
      );
    }
  }
};

export type ConfigFamily = {
  config: DocstubeConfig;
  ia: Ia;
  glossary: Glossary;
  raw: { config: string; ia: string; glossary: string | undefined };
};

export const loadConfigFamily = async (repoRoot: string): Promise<ConfigFamily> => {
  const configText = await readOptional(join(repoRoot, configFileNames.config));
  if (configText === undefined) {
    throw new CoreError(
      'config-missing',
      `${configFileNames.config} not found — run \`docstube wizard\` to create it`,
      {
        repoRoot
      }
    );
  }
  const iaText = await readOptional(join(repoRoot, configFileNames.ia));
  if (iaText === undefined) {
    throw new CoreError('config-missing', `${configFileNames.ia} not found — run \`docstube wizard\` to create it`, {
      repoRoot
    });
  }
  const glossaryText = await readOptional(join(repoRoot, configFileNames.glossary));
  const config = parseDocstubeConfig(configText);
  const ia = parseIaFile(iaText);
  assertNoLocaleSlugCollisions(config, ia);
  return {
    config,
    ia,
    glossary: glossaryText === undefined ? { schemaVersion: 1, terms: [] } : parseGlossaryFile(glossaryText),
    raw: { config: configText, ia: iaText, glossary: glossaryText }
  };
};

// Comment-preserving edit: the callback mutates the parsed Document; serialization keeps
// comments, anchors, and formatting intact.
export const editYamlDocument = (source: string, edit: (doc: Document) => void): string => {
  const doc = parseDocument(source);
  edit(doc);
  return doc.toString();
};

export type YamlPath = ReadonlyArray<string | number>;

export const setYamlIn = (source: string, path: YamlPath, value: unknown): string =>
  editYamlDocument(source, (doc) => {
    doc.setIn([...path], value);
  });

const schemaByFileName: Record<(typeof configFileNames)[keyof typeof configFileNames], z.ZodType<unknown>> = {
  [configFileNames.config]: docstubeConfigSchema,
  [configFileNames.ia]: iaSchema,
  [configFileNames.glossary]: glossarySchema
};

export const editConfigFile = async (
  repoRoot: string,
  fileName: (typeof configFileNames)[keyof typeof configFileNames],
  edit: (doc: Document) => void
): Promise<void> => {
  const path = join(repoRoot, fileName);
  const source = await readFile(path, 'utf8');
  const next = editYamlDocument(source, edit);
  // Validate the RESULT before anything touches disk — an edit that would corrupt the file (per
  // the schema that owns it) rejects atomically, same contract as updateConfigValues.
  parseWith(schemaByFileName[fileName], next, fileName);
  await writeFile(path, next, 'utf8');
};
