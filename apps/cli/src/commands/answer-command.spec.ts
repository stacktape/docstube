import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildFixturePage, buildFixturePageShard, idPrefixes, knowledgeFactSchema, mintId } from '@docstube/contracts';
import { createManifestStore } from '@docstube/core';
import type { CliOutput } from '../cli-output.ts';
import { runAnswerCommand } from './answer-command.ts';

let workspaceDir: string;
let lines: string[];
let errors: string[];
const output: CliOutput = {
  info: (message) => lines.push(message),
  error: (message) => errors.push(message)
};

const configYaml =
  'schemaVersion: 1\ndocType: external-library\npersonas:\n  - id: dev\n    description: d\nsite:\n  title: G\n';

beforeEach(async () => {
  workspaceDir = await mkdtemp(join(tmpdir(), 'docstube-answer-'));
  lines = [];
  errors = [];
  await writeFile(join(workspaceDir, 'docstube.yml'), configYaml);
  await writeFile(join(workspaceDir, 'ia.yml'), 'schemaVersion: 1\ntree:\n  - title: T\n    slug: t\n    brief: b\n');
  await mkdir(join(workspaceDir, '.docstube'), { recursive: true });

  const store = createManifestStore(workspaceDir, 'latest');
  const page = buildFixturePage();
  const shard = buildFixturePageShard(page);
  await store.writePageShard({
    ...shard,
    flags: [
      {
        id: mintId(idPrefixes.flag),
        kind: 'tribal-knowledge',
        status: 'open',
        summary: 'writer question: why loud?',
        question: 'Why was the loud option added instead of a shout function?',
        entity: { version: 'latest', locale: 'en', pageId: page.id },
        createdAt: new Date().toISOString()
      }
    ]
  });
  await store.writeIndex({
    schemaVersion: 1,
    docstubeVersion: '0.0.2',
    sourceLocale: 'en',
    locales: ['en'],
    versions: [{ label: 'latest', status: 'current' }],
    pages: [{ id: page.id, slug: page.slug, title: page.title, path: `content/en/${page.slug}.mdx` }],
    configHash: '0'.repeat(64),
    iaHash: '0'.repeat(64),
    structuralGroups: [],
    systemFlags: []
  });
});

afterEach(async () => {
  await rm(workspaceDir, { recursive: true, force: true });
});

describe('docstube answer', () => {
  it('lists open questions with short ids', async () => {
    const result = await runAnswerCommand({ workspaceDir }, output);
    expect(result.exitCode).toBe(0);
    const text = lines.join('\n');
    expect(text).toContain('1 open question(s)');
    expect(text).toContain('Why was the loud option added');
  });

  it('answers by id prefix and commits the knowledge immediately', async () => {
    await runAnswerCommand({ workspaceDir }, output);
    const idLine = lines.find((line) => line.includes('Why was the loud option'));
    const short = idLine?.trim().split(/\s+/)[0] ?? '';
    lines = [];

    const result = await runAnswerCommand(
      { workspaceDir, flagId: short, text: 'Loud is a presentation concern; shout() was API bloat.' },
      output
    );
    expect(result.exitCode).toBe(0);
    expect(lines.join('\n')).toContain('committed to .docstube/knowledge/');

    // The flag carried no needId (it predates the KnowledgeNeed store) — the answer path mints the
    // need rather than dropping the answer, so both records land.
    const needs = await readdir(join(workspaceDir, '.docstube', 'knowledge', 'needs'));
    const facts = await readdir(join(workspaceDir, '.docstube', 'knowledge', 'facts'));
    expect(needs).toHaveLength(1);
    expect(facts).toHaveLength(1);
    const fact = knowledgeFactSchema.parse(
      JSON.parse(await readFile(join(workspaceDir, '.docstube', 'knowledge', 'facts', facts[0]!), 'utf8'))
    );
    expect(fact.statement).toContain('presentation concern');
    // Attribution is real: the answering surface plus the repository's git identity when it has one.
    expect(fact.author.startsWith('cli')).toBe(true);

    const store = createManifestStore(workspaceDir, 'latest');
    const index = await store.readIndex();
    const shard = await store.readPageShard({ locale: 'en', pageId: index?.pages[0]?.id ?? '' });
    expect(shard?.flags[0]?.status).toBe('resolved');

    // Re-answering: nothing open anymore.
    lines = [];
    await runAnswerCommand({ workspaceDir }, output);
    expect(lines.join('\n')).toContain('No open questions');
  });

  it('rejects unknown and requires text', async () => {
    const unknown = await runAnswerCommand({ workspaceDir, flagId: 'zzzzzzzz', text: 'x' }, output);
    expect(unknown.exitCode).toBe(1);
    const noText = await runAnswerCommand({ workspaceDir, flagId: 'a' }, output);
    expect(noText.exitCode).toBe(1);
  });
});
