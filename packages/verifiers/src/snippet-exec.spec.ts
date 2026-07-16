import { execFile } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import type { PluginExec, VerifierContext } from '@docstube/plugin-sdk';
import { snippetExecVerifier } from './snippet-exec.ts';
import { makeArtifact, makeBlock, makeClaim, makeContext, makePage, makeSection } from './test-support.ts';

const mdxWithFence = (info: string, code: string): string => `# Title\n\n\`\`\`${info}\n${code}\n\`\`\`\n`;

// Real subprocess exec for the node-backed tests: node is the runtime CI already has, so running
// it is as deterministic as the test process itself. Never used for bash/shellcheck.
const realExec: PluginExec = (command, args, options) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      command,
      args,
      { cwd: options?.cwd, timeout: options?.timeoutMs, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (error && child.exitCode === null) {
          reject(error);
          return;
        }
        resolve({ exitCode: child.exitCode ?? 0, stdout, stderr });
      }
    );
  });

const withExec = (exec: PluginExec): VerifierContext => ({ ...makeContext(), exec });

const missingBashExec: PluginExec = async (command) => {
  if (command === 'bash') {
    throw Object.assign(new Error('spawn bash ENOENT'), { code: 'ENOENT' });
  }
  return { exitCode: 0, stdout: '', stderr: '' };
};

const pageWithBlock = (code: string, language: string) => {
  const claim = makeClaim('the sample runs');
  const block = makeBlock({ content: code, blockType: 'code-example', language, claims: [claim] });
  const page = makePage({ slug: 'guide', sections: [makeSection({ anchor: 'usage', blocks: [block] })] });
  return { block, claim, page };
};

describe('snippet-exec', () => {
  it('fails a bash script that exits non-zero, with a stderr tail', async () => {
    const code = 'echo "about to fail" >&2\nexit 1';
    const { block, page } = pageWithBlock(code, 'bash');
    const exec: PluginExec = async (command, args) => {
      if (command === 'bash' && args[0] === '--version') {
        return { exitCode: 0, stdout: 'GNU bash', stderr: '' };
      }
      expect(command).toBe('bash');
      expect(args.slice(0, 3)).toEqual(['-euo', 'pipefail', '-c']);
      expect(args[3]).toBe(code);
      return { exitCode: 1, stdout: '', stderr: 'about to fail\n' };
    };

    const result = await snippetExecVerifier.verify(withExec(exec), [makeArtifact(page, mdxWithFence('bash', code))]);

    expect(result.status).toBe('fail');
    const finding = result.findings[0];
    expect(finding?.severity).toBe('error');
    expect(finding?.message).toContain('exit code 1');
    expect(finding?.message).toContain('about to fail');
    expect(finding?.entity?.entityId).toBe(block.id);
    expect(result.coveredEntityIds).toEqual([]);
  });

  it('caps the stderr tail at 10 lines', async () => {
    const code = 'exit 3';
    const { page } = pageWithBlock(code, 'sh');
    const stderr = Array.from({ length: 25 }, (_, index) => `line-${index + 1}`).join('\n');
    const exec: PluginExec = async (_command, args) =>
      args[0] === '--version' ? { exitCode: 0, stdout: '', stderr: '' } : { exitCode: 3, stdout: '', stderr };

    const result = await snippetExecVerifier.verify(withExec(exec), [makeArtifact(page, mdxWithFence('sh', code))]);

    const message = result.findings[0]?.message ?? '';
    expect(message).toContain('line-25');
    expect(message).toContain('line-16');
    expect(message).not.toContain('line-15\n');
  });

  it('passes a node script through a real subprocess and covers the block and claims', async () => {
    const code = 'const total = [1, 2, 3].reduce((sum, n) => sum + n, 0);\nif (total !== 6) { process.exit(1); }';
    const { block, claim, page } = pageWithBlock(code, 'js');

    const result = await snippetExecVerifier.verify(withExec(realExec), [makeArtifact(page, mdxWithFence('js', code))]);

    expect(result.status).toBe('pass');
    expect(result.findings).toEqual([]);
    expect(result.coveredEntityIds).toContain(block.id);
    expect(result.coveredEntityIds).toContain(claim.id);
  });

  it('transpiles and executes a TypeScript snippet', async () => {
    const code = 'const double = (value: number): number => value * 2;\nif (double(21) !== 42) { process.exit(1); }';
    const { block, page } = pageWithBlock(code, 'ts');

    const result = await snippetExecVerifier.verify(withExec(realExec), [makeArtifact(page, mdxWithFence('ts', code))]);

    expect(result.status).toBe('pass');
    expect(result.findings).toEqual([]);
    expect(result.coveredEntityIds).toContain(block.id);
  });

  it('fails a node script that exits non-zero', async () => {
    const code = "console.error('boom');\nprocess.exit(2);";
    const { block, page } = pageWithBlock(code, 'javascript');

    const result = await snippetExecVerifier.verify(withExec(realExec), [
      makeArtifact(page, mdxWithFence('javascript', code))
    ]);

    expect(result.status).toBe('fail');
    expect(result.findings[0]?.message).toContain('exit code 2');
    expect(result.findings[0]?.message).toContain('boom');
    expect(result.findings[0]?.entity?.entityId).toBe(block.id);
  });

  it('skips fences marked no-exec without spawning anything', async () => {
    const code = 'rm -rf /important';
    const { page } = pageWithBlock(code, 'bash');
    const calls: string[] = [];
    const exec: PluginExec = async (command) => {
      calls.push(command);
      return { exitCode: 0, stdout: '', stderr: '' };
    };

    const result = await snippetExecVerifier.verify(withExec(exec), [
      makeArtifact(page, mdxWithFence('bash title="danger" no-exec', code))
    ]);

    expect(result.status).toBe('pass');
    expect(result.findings).toEqual([]);
    expect(result.coveredEntityIds).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('reports the whole run as skipped when bash is absent and only bash blocks match', async () => {
    const code = 'echo hello';
    const { page } = pageWithBlock(code, 'bash');

    const result = await snippetExecVerifier.verify(withExec(missingBashExec), [
      makeArtifact(page, mdxWithFence('bash', code))
    ]);

    expect(result.status).toBe('skipped');
    expect(result.findings).toEqual([]);
    expect(result.coveredEntityIds).toEqual([]);
  });

  it('still runs node blocks when bash is absent', async () => {
    const bashCode = 'echo hello';
    const jsCode = 'const ok = true;';
    const bashBlock = makeBlock({ content: bashCode, blockType: 'code-example', language: 'bash' });
    const jsBlock = makeBlock({ content: jsCode, blockType: 'code-example', language: 'js' });
    const page = makePage({ slug: 'guide', preamble: [bashBlock, jsBlock] });
    const mdx = `${mdxWithFence('bash', bashCode)}\n${mdxWithFence('js', jsCode)}`;
    const exec: PluginExec = async (command, args, options) => {
      if (command === 'bash') {
        throw Object.assign(new Error('spawn bash ENOENT'), { code: 'ENOENT' });
      }
      return realExec(command, args, options);
    };

    const result = await snippetExecVerifier.verify(withExec(exec), [makeArtifact(page, mdx)]);

    expect(result.status).toBe('pass');
    expect(result.coveredEntityIds).toContain(jsBlock.id);
    expect(result.coveredEntityIds).not.toContain(bashBlock.id);
  });

  it('reports a warning (still pass) when the block has no matching fence', async () => {
    const block = makeBlock({ content: 'echo gone', blockType: 'code-example', language: 'bash' });
    const page = makePage({ slug: 'guide', preamble: [block] });

    const result = await snippetExecVerifier.verify(withExec(makeContext().exec), [
      makeArtifact(page, mdxWithFence('bash', 'echo different'))
    ]);

    expect(result.status).toBe('pass');
    expect(result.findings[0]?.severity).toBe('warning');
    expect(result.coveredEntityIds).toEqual([]);
  });
});

describe('snippet-exec module-not-found policy', () => {
  it('leaves a snippet importing an uninstalled package uncovered without failing it', async () => {
    const code = "import { greet } from 'not-installed-pkg';\n\nconsole.log(greet('x'));";
    const { block, page } = pageWithBlock(code, 'ts');

    const result = await snippetExecVerifier.verify(withExec(realExec), [makeArtifact(page, mdxWithFence('ts', code))]);

    expect(result.status).toBe('pass');
    expect(result.findings).toEqual([]);
    expect(result.coveredEntityIds).not.toContain(block.id);
  });
});
