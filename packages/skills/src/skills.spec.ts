import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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
} from './skills';

const withTempDir = async (run: (dir: string) => Promise<void>) => {
  const dir = await mkdtemp(join(tmpdir(), 'docstube-skills-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

describe('built-in skills', () => {
  it('ships role-scoped and reference skills with code-wins guidance', () => {
    expect(builtInSkillIds).toEqual([
      'writer',
      'reviewer',
      'verifier',
      'editor',
      'component-reference',
      'd2-authoring',
      'writing-conventions'
    ]);
    expect(builtInSkills.map((skill) => skill.id)).toEqual(builtInSkillIds);
    expect(builtInSkills.find((skill) => skill.id === 'writer')?.content).toContain(
      'code-grounded facts, report the drift and treat code as authoritative'
    );
    expect(builtInSkills.find((skill) => skill.id === 'component-reference')?.content).toContain(
      'Screenshot is reserved'
    );
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
        code: 'reference-doc-drift',
        severity: 'major',
        origin: 'verifier',
        message: 'Reference doc disagrees with code-grounded fact "cli-generate-command". Code wins this conflict.',
        location: { path: 'README.md' },
        meta: {
          codeFact: 'docstube generate',
          codeSourcePath: 'apps/cli/src/cli.ts',
          referenceClaim: 'docstube init'
        }
      }
    ]);
  });
});
