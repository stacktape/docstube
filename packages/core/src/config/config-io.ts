import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Document } from 'yaml';
import { parse, parseDocument } from 'yaml';
import type { z } from 'zod';
import type { DocstubeConfig, Glossary, Ia } from '@docstube/contracts';
import { docstubeConfigSchema, glossarySchema, iaSchema } from '@docstube/contracts';
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
  return {
    config: parseDocstubeConfig(configText),
    ia: parseIaFile(iaText),
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

export const editConfigFile = async (
  repoRoot: string,
  fileName: (typeof configFileNames)[keyof typeof configFileNames],
  edit: (doc: Document) => void
): Promise<void> => {
  const path = join(repoRoot, fileName);
  const source = await readFile(path, 'utf8');
  await writeFile(path, editYamlDocument(source, edit), 'utf8');
};
