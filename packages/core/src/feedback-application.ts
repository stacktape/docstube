import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { dirname as posixDirname, join as posixJoin } from 'node:path/posix';
import { z } from 'zod';
import { feedbackRecordSchema } from '@docstube/contracts';
import type { FeedbackRecord, RelativePath } from '@docstube/contracts';
import { editYamlDocument } from './config-yaml.ts';
import { loadProjectConfigFamily, normalizeRelativePath, resolveWorkspacePath } from './project-workspace.ts';
import type { StateBackend } from './state-backend.ts';

export const feedbackApplicationTargets = ['config', 'criteria', 'glossary', 'instructions'] as const;

export const feedbackApplicationTargetSchema = z.enum(feedbackApplicationTargets);

export type FeedbackApplicationTarget = z.infer<typeof feedbackApplicationTargetSchema>;

export const feedbackApplicationInputSchema = z.strictObject({
  target: feedbackApplicationTargetSchema,
  record: feedbackRecordSchema
});

export type FeedbackApplicationInput = z.infer<typeof feedbackApplicationInputSchema>;

export type FeedbackApplicationResult = {
  feedback: FeedbackRecord;
  target: FeedbackApplicationTarget;
  written: RelativePath[];
};

export type ApplyFeedbackToProjectFilesInput = FeedbackApplicationInput & {
  backend: StateBackend;
  configPath?: string;
  workspaceDir?: string;
};

const feedbackMarkdownPath = (target: 'criteria' | 'instructions'): RelativePath =>
  normalizeRelativePath(`.docstube/${target}/feedback.md`);

const configRelativePath = (configPath: string, path: RelativePath): RelativePath => {
  const configDir = posixDirname(configPath);
  return normalizeRelativePath(configDir === '.' ? path : posixJoin(configDir, path));
};

const compactMessage = (message: string): string => message.replace(/\s+/g, ' ').trim();

const feedbackHeading = (record: FeedbackRecord): string =>
  [
    `- ${record.createdAt}`,
    `id=${record.id}`,
    `scope=${record.scope}`,
    record.pageId ? `page=${record.pageId}` : undefined,
    record.sectionId ? `section=${record.sectionId}` : undefined,
    record.selector ? `selector=${record.selector}` : undefined
  ]
    .filter((part): part is string => part !== undefined)
    .join(' ');

const markdownEntry = (record: FeedbackRecord): string => `${feedbackHeading(record)}\n  ${record.message}\n`;

const appendTextFile = async (path: string, entry: string): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const current = await readFile(path, 'utf8').catch(() => '# docstube feedback\n\n');
  const separator = current.endsWith('\n') ? '' : '\n';
  await writeFile(path, `${current}${separator}${entry}`, 'utf8');
};

const yamlFeedbackComment = (record: FeedbackRecord): string =>
  `docstube feedback ${record.id} (${record.scope}${record.pageId ? ` ${record.pageId}` : ''}): ${compactMessage(
    record.message
  )}`;

const appendYamlDocumentComment = async (path: string, record: FeedbackRecord): Promise<void> => {
  const current = await readFile(path, 'utf8');
  const next = editYamlDocument(current, (doc) => {
    const currentComment = doc.comment ?? '';
    const comment = yamlFeedbackComment(record);
    doc.comment = currentComment ? `${currentComment}\n${comment}` : comment;
  });
  await writeFile(path, next, 'utf8');
};

const applyToMarkdownTarget = async (input: {
  record: FeedbackRecord;
  target: 'criteria' | 'instructions';
  workspaceDir: string;
}): Promise<RelativePath> => {
  const path = feedbackMarkdownPath(input.target);
  await appendTextFile(resolveWorkspacePath(input.workspaceDir, path), markdownEntry(input.record));
  return path;
};

const applyToYamlTarget = async (input: {
  configPath: string;
  record: FeedbackRecord;
  target: 'config' | 'glossary';
  workspaceDir: string;
}): Promise<RelativePath> => {
  const configPath = normalizeRelativePath(input.configPath);
  const path =
    input.target === 'config'
      ? configPath
      : configRelativePath(configPath, (await loadProjectConfigFamily(input.workspaceDir, configPath)).config.glossary);
  await appendYamlDocumentComment(resolveWorkspacePath(input.workspaceDir, path), input.record);
  return path;
};

export const applyFeedbackToProjectFiles = async (
  input: ApplyFeedbackToProjectFilesInput
): Promise<FeedbackApplicationResult> => {
  const feedback = await input.backend.submitFeedback(input.record);
  const written: RelativePath[] = [];

  if (input.workspaceDir) {
    const configPath = input.configPath ?? 'docstube.yml';
    if (input.target === 'criteria' || input.target === 'instructions') {
      written.push(
        await applyToMarkdownTarget({ workspaceDir: input.workspaceDir, target: input.target, record: feedback })
      );
    } else {
      written.push(
        await applyToYamlTarget({
          workspaceDir: input.workspaceDir,
          configPath,
          target: input.target,
          record: feedback
        })
      );
    }
  }

  return { feedback, target: input.target, written };
};
