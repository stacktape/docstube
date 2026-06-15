import type { Document } from 'yaml';
import { parse, parseDocument } from 'yaml';
import {
  type DocstubeConfig,
  type Glossary,
  type Ia,
  parseDocstubeConfig,
  parseGlossary,
  parseIa
} from '@docstube/contracts';

// Config loading and comment-preserving edits for the config family.
//
// docstube.yml is user-owned typed YAML. Wizard edits must preserve comments and formatting, so
// edits go through the `yaml` package Document API rather than a parse/serialize round trip that
// would discard comments. Schema validation is delegated to @docstube/contracts.

export const parseYaml = (text: string): unknown => parse(text);

export const loadDocstubeConfig = (text: string): DocstubeConfig => parseDocstubeConfig(parse(text));

export const loadIa = (text: string): Ia => parseIa(parse(text));

export const loadGlossary = (text: string): Glossary => parseGlossary(parse(text));

// Edit a YAML document in place while preserving its comments and formatting. The callback
// mutates the parsed `Document`; the serialized result is returned.
export const editYamlDocument = (source: string, edit: (doc: Document) => void): string => {
  const doc = parseDocument(source);
  edit(doc);
  return doc.toString();
};

export type YamlPath = ReadonlyArray<string | number>;

// Set a single value at a path, preserving surrounding comments and formatting.
export const setYamlIn = (source: string, path: YamlPath, value: unknown): string =>
  editYamlDocument(source, (doc) => {
    doc.setIn([...path], value);
  });
