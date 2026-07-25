import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanClaimMarkers } from '@docstube/agent-runtime';
import type { AgentTaskSpec, Transcript, WriterClaimLedger } from '@docstube/contracts';
import { runGenerateCommand } from './generate-command.ts';
import { runRefineCommand } from './refine-command.ts';
import type { CliOutput } from '../cli-output.ts';

// EMISSION AFTER PARTIAL FAILURE (wave 2b close final) — the refine mirror of the generate test:
// refine persists page by page, so a later page throwing leaves earlier pages committed with
// fresh shards while the rendered routes still show the pre-refine state. The command must run
// the shared assemble step over the consistent persisted state before surfacing the run error.

let repoRoot: string;

const pageMdx = (title: string): string =>
  `---\ntitle: ${title}\ndescription: Install and greet.\n---\n\n# ${title}\n\n` +
  '<Claim id="c1">The library exposes a single `greet` function.</Claim>\n';

const refinedMdx = (title: string): string =>
  `${pageMdx(title)}\nAlso, <Claim id="c2">\`greet\` returns a string.</Claim>\n`;

const ledgerFor = (source: string): WriterClaimLedger => ({
  schemaVersion: 1,
  claims: scanClaimMarkers(source).markers.map((marker) => ({
    markerId: marker.markerId,
    class: 'code-structure',
    predicate: marker.innerMdx,
    proposedEvidence: [],
    proposedSubscriptions: [{ kind: 'file-content', file: 'src/greeter.ts' }]
  }))
});

const baseTranscript = (spec: AgentTaskSpec) => ({
  schemaVersion: 1 as const,
  taskId: spec.id,
  cacheKey: 'test',
  transport: 'replay',
  model: 'scripted',
  observedReads: [{ file: 'src/greeter.ts', contentHash: '0'.repeat(64) }],
  usage: { inputTokens: 1, outputTokens: 1, cacheHit: false },
  stopReason: 'complete' as const,
  turns: []
});

const exploding = async (): Promise<Transcript> => {
  throw new Error('writer transport exploded');
};

const passingReview = (spec: AgentTaskSpec): Transcript =>
  ({
    ...baseTranscript(spec),
    observedReads: [],
    result: {
      type: 'structured',
      value: {
        persona: 'app-developer',
        criteria: [{ criterion: 'audience-fit', outcome: 'met', reasoning: 'fits' }],
        findings: []
      }
    }
  }) as Transcript;

// Writes whatever the page's title heading asks for, so the same runner serves both fixture pages.
const titleOf = (spec: AgentTaskSpec): string =>
  spec.userPrompt.includes('greeting') ? 'Greeting' : 'Getting started';

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'docstube-refine-cmd-'));
  await mkdir(join(repoRoot, 'src'), { recursive: true });
  await writeFile(
    join(repoRoot, 'src', 'greeter.ts'),
    'export const greet = (name: string): string => `Hi ${name}`;\n'
  );
  await writeFile(join(repoRoot, 'package.json'), JSON.stringify({ name: 'greeter', type: 'module' }));
  await writeFile(
    join(repoRoot, 'docstube.yml'),
    'schemaVersion: 1\ndocType: external-library\npersonas:\n  - id: app-developer\n    description: Builds apps\nsite:\n  title: Greeter Docs\n'
  );
  await writeFile(
    join(repoRoot, 'ia.yml'),
    'schemaVersion: 1\ntree:\n  - title: Getting started\n    slug: getting-started\n    brief: Install and greet.\n' +
      '  - title: Greeting\n    slug: greeting\n    brief: How the greeting works.\n'
  );
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

describe('runRefineCommand', () => {
  it('emits the persisted state even when refine throws after a page landed, then surfaces the run error', async () => {
    const lines: string[] = [];
    const output: CliOutput = { info: (message) => lines.push(message), error: (message) => lines.push(message) };

    // Run 1: an ordinary generate establishes both pages, their shards, and their routes.
    const generateRunner = async (spec: AgentTaskSpec): Promise<Transcript> => {
      if (spec.kind === 'review-page') {
        return passingReview(spec);
      }
      const mdx = pageMdx(titleOf(spec));
      return { ...baseTranscript(spec), result: { type: 'mdx-ledger', mdx, ledger: ledgerFor(mdx) } } as Transcript;
    };
    const generated = await runGenerateCommand(
      { workspaceDir: repoRoot, taskRunner: { runTask: generateRunner, toolDescriptors: [] } },
      output
    );
    expect(generated.exitCode).toBe(0);
    const routes = ['getting-started', 'greeting'].map((slug) =>
      join(repoRoot, 'docs-site', 'src', 'pages', `${slug}.mdx`)
    );
    for (const route of routes) {
      expect(await readFile(route, 'utf8')).toContain('docstubeClaimsTotal: 1');
    }

    // Run 2: the FIRST refined page gets a second claim and persists; the writer then explodes on
    // the next page, so runRefine throws with one page already committed.
    let writes = 0;
    const refineRunner = async (spec: AgentTaskSpec): Promise<Transcript> => {
      if (spec.kind === 'review-page') {
        return passingReview(spec);
      }
      writes += 1;
      if (writes > 1) {
        throw new Error('writer transport exploded');
      }
      const mdx = refinedMdx(titleOf(spec));
      return { ...baseTranscript(spec), result: { type: 'mdx-ledger', mdx, ledger: ledgerFor(mdx) } } as Transcript;
    };
    await expect(
      runRefineCommand({ workspaceDir: repoRoot, taskRunner: { runTask: refineRunner, toolDescriptors: [] } }, output)
    ).rejects.toThrow('writer transport exploded');

    // The finally-shaped emission ran before the error escaped: exactly one route now matches its
    // new two-claim shard, and the other still matches its untouched one — no route disagrees
    // with the shard it renders.
    expect(lines.some((line) => line.includes('re-emitted'))).toBe(true);
    const rendered = await Promise.all(routes.map((route) => readFile(route, 'utf8')));
    expect(rendered.filter((route) => route.includes('docstubeClaimsTotal: 2'))).toHaveLength(1);
    expect(rendered.find((route) => route.includes('docstubeClaimsTotal: 2'))).toContain('`greet` returns a string.');
  }, 180_000);

  it('no-ops the emission when nothing was ever persisted', async () => {
    const lines: string[] = [];
    const output: CliOutput = { info: (message) => lines.push(message), error: (message) => lines.push(message) };
    // No generate ran first, so there is no manifest: the emission attempt no-ops (emitted:false)
    // and the command reports only the run error — it never claims to have re-emitted anything.
    const result = await runRefineCommand(
      { workspaceDir: repoRoot, taskRunner: { runTask: exploding, toolDescriptors: [] } },
      output
    );
    expect(result.exitCode).toBe(1);
    expect(lines.some((line) => line.includes('re-emitted'))).toBe(false);
  }, 120_000);
});
