import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { DocstubeConfig, Ia } from '@docstube/contracts';
import type { Document } from 'yaml';
import { editYamlDocument, loadDocstubeConfig, loadIa } from './config-yaml';

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
  ia: Ia;
  iaPath: string;
  iaText: string;
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
  const iaPath = input.config.ia;
  const absoluteConfigPath = join(input.workspaceDir, configPath);
  const absoluteIaPath = join(input.workspaceDir, iaPath);
  const [configSource, iaSource] = await Promise.all([
    readFile(absoluteConfigPath, 'utf8'),
    readFile(absoluteIaPath, 'utf8')
  ]);

  const configText = updateConfigDocument(configSource, input.config);
  const iaText = updateIaDocument(iaSource, input.ia);
  const config = loadDocstubeConfig(configText);
  const ia = loadIa(iaText);

  await Promise.all([
    mkdir(dirname(absoluteConfigPath), { recursive: true }),
    mkdir(dirname(absoluteIaPath), { recursive: true })
  ]);
  await Promise.all([writeFile(absoluteConfigPath, configText, 'utf8'), writeFile(absoluteIaPath, iaText, 'utf8')]);

  return { config, ia, configPath, iaPath, configText, iaText };
};
