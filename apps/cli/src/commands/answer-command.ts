import { applyFlagAnswers, CoreError, createManifestStore, loadConfigFamily } from '@docstube/core';
import type { Flag } from '@docstube/contracts';
import type { CliCommandResult, CliOutput } from '../cli-output.ts';

// `docstube answer` closes the tribal-knowledge loop from the terminal: list open maintainer
// questions, answer one by (prefix of) its flag id. The answer is applied to the knowledge store
// immediately, so the very next run already injects it.

export type AnswerCommandInput = {
  workspaceDir: string;
  flagId?: string | undefined;
  text?: string | undefined;
};

type OpenQuestion = { flag: Flag; locale: string; pageId: string; slug: string };

const shortId = (flagId: string): string => flagId.slice('fl_'.length, 'fl_'.length + 8);

export const runAnswerCommand = async (input: AnswerCommandInput, output: CliOutput): Promise<CliCommandResult> => {
  try {
    const family = await loadConfigFamily(input.workspaceDir);
    const store = createManifestStore(input.workspaceDir, family.config.versions.current);
    const index = await store.readIndex();
    if (index === undefined) {
      output.error('No manifest yet — run `docstube generate` first.');
      return { exitCode: 1 };
    }

    const locales = [family.config.locales.source, ...family.config.locales.targets];
    const open: OpenQuestion[] = [];
    for (const entry of index.pages) {
      for (const locale of locales) {
        const shard = await store.readPageShard({ locale, pageId: entry.id });
        for (const flag of shard?.flags ?? []) {
          if (flag.kind === 'tribal-knowledge' && flag.status === 'open' && flag.question) {
            open.push({ flag, locale, pageId: entry.id, slug: entry.slug });
          }
        }
      }
    }

    if (input.flagId === undefined) {
      if (open.length === 0) {
        output.info('No open questions — the writers have everything they need.');
        return { exitCode: 0 };
      }
      output.info(`${open.length} open question(s):\n`);
      for (const question of open) {
        output.info(`  ${shortId(question.flag.id)}  [${question.slug}]  ${question.flag.question}`);
        if (question.flag.detail) {
          output.info(`            why it matters: ${question.flag.detail}`);
        }
      }
      output.info('\nAnswer one with: docstube answer <id> "your answer"');
      return { exitCode: 0 };
    }

    if (input.text === undefined || input.text.trim() === '') {
      output.error('usage: docstube answer <id> "your answer"');
      return { exitCode: 1 };
    }
    const needle = input.flagId.replace(/^fl_/, '');
    const matches = open.filter((question) => shortId(question.flag.id).startsWith(needle));
    if (matches.length === 0) {
      output.error(`no open question matches "${input.flagId}" — run \`docstube answer\` to list them`);
      return { exitCode: 1 };
    }
    if (matches.length > 1) {
      output.error(`"${input.flagId}" is ambiguous (${matches.length} matches) — use more characters`);
      return { exitCode: 1 };
    }
    const target = matches[0]!;

    const shard = await store.readPageShard({ locale: target.locale, pageId: target.pageId });
    if (shard === undefined) {
      output.error('shard vanished while answering — retry');
      return { exitCode: 1 };
    }
    await store.writePageShard({
      ...shard,
      flags: shard.flags.map((flag) =>
        flag.id === target.flag.id
          ? {
              ...flag,
              status: 'answered' as const,
              answer: { text: input.text!.trim(), answeredAt: new Date().toISOString(), author: 'cli' }
            }
          : flag
      )
    });
    // Commit to the knowledge store right away (marks the flag resolved).
    const applied = await applyFlagAnswers({
      repoRoot: input.workspaceDir,
      store,
      locales,
      pageIds: index.pages.map((entry) => entry.id)
    });
    output.info(`answered — ${applied} answer(s) committed to .docstube/knowledge/; future runs will use it.`);
    return { exitCode: 0 };
  } catch (error) {
    if (error instanceof CoreError) {
      output.error(error.message);
      return { exitCode: 1 };
    }
    throw error;
  }
};
