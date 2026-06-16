import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { dirname as posixDirname, join as posixJoin } from 'node:path/posix';
import type { DocstubeConfig, Ia } from '@docstube/contracts';
import type { Document } from 'yaml';
import { editYamlDocument, loadDocstubeConfig, loadIa } from './config-yaml.ts';
import { normalizeRelativePath, resolveWorkspacePath } from './project-workspace.ts';

export type SetupWizardFileWriteInput = {
  config: DocstubeConfig;
  configPath?: string;
  ia: Ia;
  workspaceDir: string;
};

export type SetupWizardFileWriteResult = {
  config: DocstubeConfig;
  configPath: string;
  configText: string;
  glossaryPath: string;
  glossaryText?: string;
  ia: Ia;
  iaPath: string;
  iaText: string;
};

const defaultConfigSource =
  '# docstube configuration. Edited by the setup wizard with comments preserved.\nversion: 1\n';

const defaultIaSource = '# Information architecture. Editable as a NavTree in the setup wizard.\nversion: 1\nnav: []\n';

const defaultGlossarySource = '# Glossary terms used by generated documentation.\nversion: 1\nterms: []\n';

const readTextOrDefault = async (path: string, fallback: string): Promise<string> => {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return fallback;
  }
};

const setOptionalTopLevel = (doc: Document, key: string, value: unknown): void => {
  if (value === undefined) {
    doc.delete(key);
    return;
  }

  doc.set(key, value);
};

const updateConfigDocument = (source: string, config: DocstubeConfig): string =>
  editYamlDocument(source, (doc) => {
    doc.set('version', config.version);
    doc.set('site', config.site);
    doc.set('docsType', config.docsType);
    doc.set('output', config.output);
    doc.set('personas', config.personas);
    doc.set('agents', config.agents);
    doc.set('ia', config.ia);
    doc.set('glossary', config.glossary);
    setOptionalTopLevel(doc, 'theme', config.theme);
    setOptionalTopLevel(doc, 'sources', config.sources);
    setOptionalTopLevel(doc, 'caps', config.caps);
    setOptionalTopLevel(doc, 'screenshots', config.screenshots);
  });

const updateIaDocument = (source: string, ia: Ia): string =>
  editYamlDocument(source, (doc) => {
    doc.set('version', ia.version);
    setOptionalTopLevel(doc, 'layout', ia.layout);
    doc.set('nav', ia.nav);
  });

export const writeSetupWizardFiles = async (input: SetupWizardFileWriteInput): Promise<SetupWizardFileWriteResult> => {
  const configPath = input.configPath ?? 'docstube.yml';
  const configDir = posixDirname(configPath);
  const configRelativeDir = configDir === '.' ? '' : configDir;
  const resolveConfigRelative = (path: string): string =>
    configRelativeDir ? posixJoin(configRelativeDir, path) : path;
  const iaPath = input.config.ia;
  const glossaryPath = input.config.glossary;
  const absoluteConfigPath = resolveWorkspacePath(input.workspaceDir, normalizeRelativePath(configPath));
  const absoluteIaPath = resolveWorkspacePath(input.workspaceDir, normalizeRelativePath(resolveConfigRelative(iaPath)));
  const absoluteGlossaryPath = resolveWorkspacePath(
    input.workspaceDir,
    normalizeRelativePath(resolveConfigRelative(glossaryPath))
  );
  const [configSource, iaSource] = await Promise.all([
    readTextOrDefault(absoluteConfigPath, defaultConfigSource),
    readTextOrDefault(absoluteIaPath, defaultIaSource)
  ]);

  const configText = updateConfigDocument(configSource, input.config);
  const iaText = updateIaDocument(iaSource, input.ia);
  const config = loadDocstubeConfig(configText);
  const ia = loadIa(iaText);

  await Promise.all([
    mkdir(dirname(absoluteConfigPath), { recursive: true }),
    mkdir(dirname(absoluteIaPath), { recursive: true }),
    mkdir(dirname(absoluteGlossaryPath), { recursive: true })
  ]);
  const glossaryText = await readTextOrDefault(absoluteGlossaryPath, defaultGlossarySource);
  await Promise.all([
    writeFile(absoluteConfigPath, configText, 'utf8'),
    writeFile(absoluteIaPath, iaText, 'utf8'),
    writeFile(absoluteGlossaryPath, glossaryText, 'utf8')
  ]);

  return { config, ia, configPath, glossaryPath, glossaryText, iaPath, configText, iaText };
};
