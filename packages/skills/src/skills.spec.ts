import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pluginCapabilityKindSchema, pluginManifestSchema } from '@docstube/contracts';
import {
  examplePluginManifest,
  examplePluginSource,
  exampleSpecSource,
  renderManifestLiteral
} from './plugin-authoring-example.ts';
import {
  builtInSkillIds,
  builtInSkills,
  createDriftReport,
  createGitSourceReference,
  createMcpSourceReference,
  loadPathSources,
  materializeBuiltInSkills,
  skillOwnershipMarker,
  skillUserEditedMarker
} from './skills.ts';

const withTempDir = async (run: (dir: string) => Promise<void>) => {
  const dir = await mkdtemp(join(tmpdir(), 'docstube-skills-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

const skillContent = (id: (typeof builtInSkillIds)[number]): string =>
  builtInSkills.find((skill) => skill.id === id)?.content ?? '';

describe('built-in skills', () => {
  it('ships the lean v1 skill set with code-wins guidance', () => {
    expect(builtInSkillIds).toEqual(['writer', 'reviewer', 'writing-conventions', 'plugin-authoring']);
    expect(builtInSkills.map((skill) => skill.id)).toEqual(builtInSkillIds);
    expect(skillContent('writer')).toContain('code-grounded facts, report the drift and treat code as authoritative');
  });

  it('writer skill mirrors the write-page hard rules', () => {
    const content = skillContent('writer');
    expect(content).toContain('Exactly one H1');
    expect(content).toContain('Never write `import`/`export` statements');
    expect(content).toContain('`layout` frontmatter key');
    expect(content).toContain('compiled and executed');
    expect(content).toContain('change nothing that was');
  });

  it('reviewer skill mirrors the review-page criteria semantics', () => {
    const content = skillContent('reviewer');
    expect(content).toContain('`met`, `not-met`, or `not-applicable`');
    for (const criterion of ['audience-fit', 'brief-conformance']) {
      expect(content).toContain(criterion);
    }
    expect(content).toContain('Severity `error` only when the page would mislead or block this persona');
    expect(content).toContain('Never assign numeric quality scores');
    // Persona review is editorial only (impl-07 finding 9): correctness lives with claim
    // verification and the risk critic, never in the reviewer skill.
    expect(content).not.toContain('correctness-risk');
    expect(content).toContain('Factual correctness is NOT');
  });

  it('writing-conventions skill bans AI-isms and demands sentence variety', () => {
    const content = skillContent('writing-conventions');
    expect(content).toContain('"delve"');
    expect(content).toContain('"seamless"');
    expect(content).toContain('Vary sentence length');
    expect(content).toContain('three consecutive sentences');
  });

  it('materializes skills non-destructively when users mark edits', async () => {
    await withTempDir(async (dir) => {
      const targetDir = join(dir, '.docstube', 'skills');
      const first = await materializeBuiltInSkills({ targetDir, skillIds: ['writer'] });
      expect(first).toHaveLength(1);
      expect(first[0]).toMatchObject({ id: 'writer', status: 'written' });

      const skillPath = first[0]!.path;
      await writeFile(
        skillPath,
        [
          skillOwnershipMarker('writer'),
          skillUserEditedMarker,
          '',
          '# Custom writer guidance',
          'Keep this edit.',
          ''
        ].join('\n'),
        'utf8'
      );

      const second = await materializeBuiltInSkills({ targetDir, skillIds: ['writer'] });
      expect(second[0]).toMatchObject({ id: 'writer', status: 'preserved' });
      await expect(readFile(skillPath, 'utf8')).resolves.toContain('Keep this edit.');
    });
  });
});

describe('plugin-authoring skill', () => {
  const content = skillContent('plugin-authoring');

  it('embeds a worked example whose manifest parses against the real plugin manifest schema', () => {
    const parsed = pluginManifestSchema.parse(examplePluginManifest);
    expect(parsed).toEqual(examplePluginManifest);
    // Single source of truth: the interpolated plugin source ships verbatim inside the skill.
    expect(content).toContain(examplePluginSource);
    expect(content).toContain(exampleSpecSource);
  });

  it('contains a definePlugin code fence built from the validated manifest constant', () => {
    // The example source itself contains ``` sequences, so locate the fence by its exact
    // interpolated content instead of regex fence-matching.
    const pluginFence = `\`\`\`ts\n${examplePluginSource}\n\`\`\``;
    expect(content).toContain(pluginFence);
    expect(examplePluginSource).toContain('definePlugin({');
    expect(examplePluginSource).toContain(renderManifestLiteral(examplePluginManifest));
    expect(examplePluginSource).toContain("name: 'docstube-plugin-wordcount'");
    expect(examplePluginSource).toContain('apiVersion: 1,');
  });

  it('documents every capability kind the manifest schema accepts, and both loading paths', () => {
    for (const kind of pluginCapabilityKindSchema.options) {
      expect(content).toContain(`\`${kind}\``);
    }
    expect(content).toContain('plugins:');
    expect(content).toContain('./plugins/wordcount.ts');
    expect(content).toContain('docstube-plugin');
  });

  it('states the verifier contract fields exactly as the SDK defines them', () => {
    for (const fragment of [
      "scope: 'block' | 'page' | 'site'",
      "localeScope: 'source-only' | 'per-locale'",
      'proves: boolean',
      'coveredEntityIds: string[]',
      "status: 'pass' | 'fail' | 'error' | 'skipped'",
      'verify: (ctx: VerifierContext, pages: PageArtifact[]) => Promise<VerifierRunResult>'
    ]) {
      expect(content).toContain(fragment);
    }
  });
});

describe('source loading', () => {
  it('redacts secrets, skips machine directories, and produces stable digests', async () => {
    await withTempDir(async (dir) => {
      await mkdir(join(dir, 'src', '.git'), { recursive: true });
      await mkdir(join(dir, 'src', 'node_modules', 'dep'), { recursive: true });
      await writeFile(
        join(dir, 'src', 'app.ts'),
        [
          'const token = "sk-123456789012345678901234";',
          'const password = "top-secret";',
          'export const ok = true;'
        ].join('\n'),
        'utf8'
      );
      await writeFile(join(dir, 'src', '.git', 'config'), 'token=do-not-load', 'utf8');
      await writeFile(join(dir, 'src', 'node_modules', 'dep', 'index.js'), 'password=do-not-load', 'utf8');

      const documents = await loadPathSources({ rootDir: dir, paths: ['src'] });
      expect(documents.map((document) => document.path)).toEqual(['src/app.ts']);
      expect(documents[0]!.content).not.toContain('top-secret');
      expect(documents[0]!.content).not.toContain('sk-123456789012345678901234');
      expect(documents[0]!.redactions.map((redaction) => redaction.kind).toSorted()).toEqual(['credential', 'secret']);
      expect(documents[0]!.digest).toMatchObject({
        algorithm: 'sha256',
        value: expect.stringMatching(/^[a-f0-9]{64}$/)
      });
    });
  });

  it('sanitizes private git references and preserves MCP pass-through references', () => {
    const git = createGitSourceReference({
      url: 'https://token:secret@example.com/acme/private-docs.git',
      ref: 'main'
    });
    expect(git.url).toBe('https://example.com/acme/private-docs.git');
    expect(JSON.stringify(git)).not.toContain('secret');
    expect(JSON.stringify(git)).not.toContain('token');

    const sshGit = createGitSourceReference({ url: 'git@github.com:acme/private-docs.git', ref: 'main' });
    expect(sshGit.url).toBe('ssh://github.com/acme/private-docs.git');

    const mcp = createMcpSourceReference({ server: 'linear', resourceUri: 'linear://issue/DOC-12' });
    expect(mcp).toMatchObject({ kind: 'mcp', server: 'linear', resourceUri: 'linear://issue/DOC-12' });
    expect(mcp.digest.value).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('reference drift reporting', () => {
  it('reports reference docs that disagree with code-grounded facts', () => {
    const report = createDriftReport({
      codeFacts: [{ id: 'cli-generate-command', sourcePath: 'apps/cli/src/cli.ts', statement: 'docstube generate' }],
      referenceClaims: [
        { id: 'cli-generate-command', sourcePath: 'README.md', statement: 'docstube init' },
        { id: 'other-reference', sourcePath: 'docs/old.md', statement: 'Informational only' }
      ]
    });

    expect(report.findings).toEqual([
      {
        source: 'verifier',
        check: 'reference-doc-drift',
        severity: 'error',
        message: 'Reference doc disagrees with code-grounded fact "cli-generate-command". Code wins this conflict.',
        file: 'README.md',
        data: {
          codeFact: 'docstube generate',
          codeSourcePath: 'apps/cli/src/cli.ts',
          referenceClaim: 'docstube init'
        }
      }
    ]);
  });
});
