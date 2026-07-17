import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentTaskSpec, Transcript } from '@docstube/contracts';
import { claimsFromTranscript, maxClaimsPerPage } from './extract-claims.ts';
import { parseForeignDocs, slugFromDocPath } from './parse-foreign-docs.ts';
import { runAudit } from './run-audit.ts';

// End-to-end audit over a real temp repo (real builtin language pack builds the codemap) and a
// foreign docs tree. Claim extraction is a scripted TaskRunner — CI never calls a live model.

let repoRoot: string;

const fixtureSource = `export type GreetOptions = {
  name: string;
  loud?: boolean;
};

export const greet = (options: GreetOptions): string => {
  const base = \`Hello, \${options.name}!\`;
  return options.loud ? base.toUpperCase() : base;
};
`;

const gettingStartedDoc = `# Getting started

The library exposes a single \`greet\` function.

It is a very pleasant library to work with.
`;

const apiDoc = `# API

Call \`removedFn\` to reset the greeter state.
`;

const structuredTranscript = (spec: AgentTaskSpec, value: unknown): Transcript => ({
  schemaVersion: 1,
  taskId: spec.id,
  cacheKey: 'test',
  transport: 'replay',
  model: 'scripted',
  turns: [],
  observedReads: [],
  usage: { inputTokens: 1, outputTokens: 1, cacheHit: false },
  stopReason: 'complete',
  result: { type: 'structured', value }
});

const anchoredClaim = (text: string, quote: string, claimClass: string, identifiers: string[]) => ({
  text,
  anchor: { quote },
  claimClass,
  identifiers
});

// Dispatches per docs file: the grounded `greet` claim + an identifier-free claim on one page,
// the stale `removedFn` claim on the other.
const scriptedRunner = () => {
  const calls: AgentTaskSpec[] = [];
  const runTask = async (spec: AgentTaskSpec): Promise<Transcript> => {
    calls.push(spec);
    expect(spec.kind).toBe('audit-extract-claims');
    if (spec.userPrompt.includes('getting-started.md')) {
      return structuredTranscript(spec, {
        claims: [
          anchoredClaim('The library exposes a greet function.', 'exposes a single `greet` function', 'api-shape', [
            'greet'
          ]),
          anchoredClaim('The library is pleasant to work with.', 'very pleasant library', 'factual', [])
        ]
      });
    }
    return structuredTranscript(spec, {
      claims: [
        anchoredClaim('removedFn resets the greeter state.', 'Call `removedFn` to reset', 'api-shape', ['removedFn'])
      ]
    });
  };
  return { runTask, calls };
};

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'docstube-audit-'));
  await mkdir(join(repoRoot, 'src'), { recursive: true });
  await mkdir(join(repoRoot, 'docs'), { recursive: true });
  await writeFile(join(repoRoot, 'src', 'greeter.ts'), fixtureSource);
  await writeFile(join(repoRoot, 'package.json'), JSON.stringify({ name: 'greeter', type: 'module' }));
  await writeFile(join(repoRoot, 'docs', 'getting-started.md'), gettingStartedDoc);
  await writeFile(join(repoRoot, 'docs', 'api.md'), apiDoc);
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

describe('runAudit', () => {
  it('grounds real symbols, reports stale references as defects, and computes the metric over all claims', async () => {
    const { runTask, calls } = scriptedRunner();
    const report = await runAudit({ repoRoot, docsDir: join(repoRoot, 'docs'), runTask });

    expect(calls).toHaveLength(2);
    expect(report.pages).toBe(2);
    expect(report.claims).toBe(3);
    // The `greet` claim matches the codemap symbol extracted from src/greeter.ts.
    expect(report.grounded).toBe(1);
    // The identifier-free claim counts in the denominator but never as a defect.
    expect(report.unverifiable).toBe(1);
    expect(report.defects).toEqual([
      {
        file: 'api.md',
        claimText: 'removedFn resets the greeter state.',
        identifier: 'removedFn',
        reason: expect.stringContaining('does not exist in the codemap')
      }
    ]);
    // 1 defect over 3 claims → 33.33 per 100.
    expect(report.defectsPer100Claims).toBe(33.33);
  }, 60_000);

  it('reports unparseable foreign files as warnings instead of dropping them silently', async () => {
    await writeFile(join(repoRoot, 'docs', 'broken.mdx'), '# Broken\n\n<Unclosed\n');
    const { runTask } = scriptedRunner();
    const report = await runAudit({ repoRoot, docsDir: join(repoRoot, 'docs'), runTask });

    expect(report.pages).toBe(2);
    expect(report.warnings.some((warning) => warning.includes('broken.mdx'))).toBe(true);
  }, 60_000);

  it('caps the audited pages with maxPages and says so', async () => {
    const { runTask, calls } = scriptedRunner();
    const report = await runAudit({ repoRoot, docsDir: join(repoRoot, 'docs'), runTask, maxPages: 1 });

    expect(calls).toHaveLength(1);
    expect(report.pages).toBe(1);
    expect(report.warnings.some((warning) => warning.includes('maxPages'))).toBe(true);
  }, 60_000);

  it('returns a clean zero-defect report shape when the docs dir has nothing to audit', async () => {
    const emptyDocs = join(repoRoot, 'docs-empty');
    await mkdir(emptyDocs, { recursive: true });
    const { runTask } = scriptedRunner();
    const report = await runAudit({ repoRoot, docsDir: emptyDocs, runTask });

    expect(report).toEqual({
      pages: 0,
      claims: 0,
      grounded: 0,
      unverifiable: 0,
      unanchoredClaims: 0,
      defects: [],
      defectsPer100Claims: 0,
      warnings: []
    });
  }, 60_000);

  it('drops claims whose anchor quote is not in the page — a hallucinated claim is never a defect', async () => {
    const runTask = async (spec: AgentTaskSpec): Promise<Transcript> =>
      structuredTranscript(spec, {
        claims: [
          anchoredClaim('phantomFn resets everything.', 'this quote appears nowhere in any page', 'api-shape', [
            'phantomFn'
          ])
        ]
      });
    const report = await runAudit({ repoRoot, docsDir: join(repoRoot, 'docs'), runTask });

    expect(report.defects).toEqual([]);
    expect(report.claims).toBe(0);
    expect(report.unanchoredClaims).toBe(2);
    expect(report.warnings.some((warning) => warning.includes('no anchor quote'))).toBe(true);
  }, 60_000);
});

describe('claimsFromTranscript', () => {
  const baseSpec = { id: 'tk_00000000000000000000' } as AgentTaskSpec;

  it('caps runaway extractions at the per-page maximum', () => {
    const value = {
      claims: Array.from({ length: maxClaimsPerPage + 5 }, (_, i) =>
        anchoredClaim(`claim ${i}`, `quote ${i}`, 'factual', [])
      )
    };
    const { claims } = claimsFromTranscript('a.md', structuredTranscript(baseSpec, value));
    expect(claims).toHaveLength(maxClaimsPerPage);
  });

  it('turns an invalid extraction into zero claims plus a warning, never a crash', () => {
    const result = claimsFromTranscript('a.md', structuredTranscript(baseSpec, { nope: true }));
    expect(result.claims).toEqual([]);
    expect(result.warning).toContain('a.md');
  });
});

describe('parseForeignDocs slugging', () => {
  it('normalizes foreign paths into the slug charset', () => {
    expect(slugFromDocPath('Guides/Getting_Started.MD.md')).toBe('guides/getting-started-md');
    expect(slugFromDocPath('api.mdx')).toBe('api');
  });

  it('walks nested directories and skips junk directories', async () => {
    await mkdir(join(repoRoot, 'docs', 'guides'), { recursive: true });
    await mkdir(join(repoRoot, 'docs', 'node_modules'), { recursive: true });
    await writeFile(join(repoRoot, 'docs', 'guides', 'advanced.mdx'), '# Advanced\n');
    await writeFile(join(repoRoot, 'docs', 'node_modules', 'junk.md'), '# Junk\n');
    const { pages } = await parseForeignDocs({ docsDir: join(repoRoot, 'docs') });
    expect(pages.map((page) => page.file)).toEqual(['api.md', 'getting-started.md', 'guides/advanced.mdx']);
    expect(pages[2]?.page.slug).toBe('guides/advanced');
    expect(pages[2]?.page.title).toBe('Advanced');
  });
});
