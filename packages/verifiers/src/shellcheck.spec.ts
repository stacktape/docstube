import { describe, expect, it } from 'vitest';
import type { PluginExec, VerifierContext } from '@docstube/plugin-sdk';
import { shellcheckVerifier } from './shellcheck.ts';
import { makeArtifact, makeBlock, makeContext, makePage } from './test-support.ts';

const mdxWithFence = (lang: string, code: string): string => `# Title\n\n\`\`\`${lang}\n${code}\n\`\`\`\n`;

const withExec = (exec: PluginExec): VerifierContext => ({ ...makeContext(), exec });

const shellcheckJson = (comments: unknown[]): string => JSON.stringify(comments);

const cleanShellcheckExec: PluginExec = async (_command, args) =>
  args[0] === '--version' ? { exitCode: 0, stdout: '', stderr: '' } : { exitCode: 0, stdout: '[]', stderr: '' };

const missingShellcheckExec: PluginExec = async () => {
  throw Object.assign(new Error('spawn shellcheck ENOENT'), { code: 'ENOENT' });
};

describe('shellcheck', () => {
  it('maps shellcheck JSON comments to findings by level', async () => {
    const code = 'echo $unquoted\n. missing-file.sh';
    const block = makeBlock({ content: code, blockType: 'code-example', language: 'bash' });
    const page = makePage({ slug: 'guide', preamble: [block] });
    const exec: PluginExec = async (command, args, options) => {
      expect(command).toBe('shellcheck');
      if (args[0] === '--version') {
        return { exitCode: 0, stdout: 'ShellCheck 0.10.0', stderr: '' };
      }
      expect(args).toEqual(['-s', 'bash', '-f', 'json', '-']);
      expect(options?.input).toBe(code);
      return {
        exitCode: 1,
        stdout: shellcheckJson([
          { line: 1, column: 6, level: 'warning', code: 2086, message: 'Double quote to prevent globbing.' },
          { line: 2, column: 1, level: 'error', code: 1091, message: 'Not following: missing-file.sh not found.' }
        ]),
        stderr: ''
      };
    };

    const result = await shellcheckVerifier.verify(withExec(exec), [makeArtifact(page, mdxWithFence('bash', code))]);

    expect(result.status).toBe('fail');
    expect(result.findings).toHaveLength(2);
    expect(result.findings[0]).toMatchObject({ severity: 'warning', span: [4, 4] });
    expect(result.findings[0]?.message).toContain('SC2086');
    expect(result.findings[1]).toMatchObject({ severity: 'error', span: [5, 5] });
    expect(result.findings[1]?.entity?.entityId).toBe(block.id);
    expect(result.coveredEntityIds).toEqual([]);
  });

  it('treats info/style levels as warnings', async () => {
    const code = 'echo ok';
    const block = makeBlock({ content: code, blockType: 'code-example', language: 'sh' });
    const page = makePage({ slug: 'guide', preamble: [block] });
    const exec: PluginExec = async (_command, args) =>
      args[0] === '--version'
        ? { exitCode: 0, stdout: '', stderr: '' }
        : {
            exitCode: 1,
            stdout: shellcheckJson([{ line: 1, column: 1, level: 'style', code: 2250, message: 'Prefer braces.' }]),
            stderr: ''
          };

    const result = await shellcheckVerifier.verify(withExec(exec), [makeArtifact(page, mdxWithFence('sh', code))]);

    expect(result.status).toBe('pass');
    expect(result.findings[0]?.severity).toBe('warning');
  });

  it('passes and covers the block when shellcheck reports nothing', async () => {
    const code = 'echo "clean"';
    const block = makeBlock({ content: code, blockType: 'code-example', language: 'bash' });
    const page = makePage({ slug: 'guide', preamble: [block] });

    const result = await shellcheckVerifier.verify(withExec(cleanShellcheckExec), [
      makeArtifact(page, mdxWithFence('bash', code))
    ]);

    expect(result.status).toBe('pass');
    expect(result.findings).toEqual([]);
    expect(result.coveredEntityIds).toEqual([block.id]);
  });

  it('reports the run as skipped when shellcheck is not installed', async () => {
    const code = 'echo hello';
    const block = makeBlock({ content: code, blockType: 'code-example', language: 'bash' });
    const page = makePage({ slug: 'guide', preamble: [block] });

    const result = await shellcheckVerifier.verify(withExec(missingShellcheckExec), [
      makeArtifact(page, mdxWithFence('bash', code))
    ]);

    expect(result.status).toBe('skipped');
    expect(result.findings).toEqual([]);
    expect(result.coveredEntityIds).toEqual([]);
  });

  it('passes without probing shellcheck when no bash/sh blocks exist', async () => {
    const page = makePage({ slug: 'guide', preamble: [makeBlock({ content: 'plain text' })] });
    const calls: string[] = [];
    const exec: PluginExec = async (command) => {
      calls.push(command);
      return { exitCode: 0, stdout: '', stderr: '' };
    };

    const result = await shellcheckVerifier.verify(withExec(exec), [makeArtifact(page, '# Title\n\nplain text\n')]);

    expect(result.status).toBe('pass');
    expect(calls).toEqual([]);
  });
});
