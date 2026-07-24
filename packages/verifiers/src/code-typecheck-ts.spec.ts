import { describe, expect, it } from 'vitest';
import { codeTypecheckTsVerifier, findCodeBlocks } from './code-typecheck-ts.ts';
import { makeArtifact, makeBlock, makeContext, makePage, makeSection } from './test-support.ts';

const mdxWithFence = (lang: string, code: string): string => `# Title\n\n\`\`\`${lang}\n${code}\n\`\`\`\n`;

describe('findCodeBlocks', () => {
  it('extracts fenced blocks with language and opening-fence line', () => {
    const mdx = '# Title\n\n```ts\nconst a = 1;\n```\n\ntext\n\n```bash title="run"\necho hi\n```\n';
    const blocks = findCodeBlocks(mdx);
    expect(blocks).toEqual([
      { lang: 'ts', code: 'const a = 1;', line: 3, meta: '' },
      { lang: 'bash', code: 'echo hi', line: 9, meta: 'title="run"' }
    ]);
  });

  it('handles multi-line code and blocks without a language', () => {
    const blocks = findCodeBlocks('```\nline1\nline2\n```\n');
    expect(blocks).toEqual([{ lang: '', code: 'line1\nline2', line: 1, meta: '' }]);
  });
});

describe('code-typecheck-ts', () => {
  it('passes a clean snippet and covers the block', async () => {
    const code = 'const x: number = 1;\nexport const doubled = x * 2;';
    const block = makeBlock({ content: code, blockType: 'code-example', language: 'ts' });
    const page = makePage({ slug: 'guide', sections: [makeSection({ anchor: 'usage', blocks: [block] })] });

    const result = await codeTypecheckTsVerifier.verify(makeContext(), [makeArtifact(page, mdxWithFence('ts', code))]);

    expect(result.status).toBe('pass');
    expect(result.findings).toEqual([]);
    expect(result.coveredEntityIds).toEqual([block.id]);
  });

  it('fails a type-error snippet with the block entity address and line info', async () => {
    const code = "const first = 1;\nconst x: number = 'nope';";
    const block = makeBlock({ content: code, blockType: 'code-example', language: 'ts' });
    const page = makePage({ slug: 'guide', preamble: [block] });

    const result = await codeTypecheckTsVerifier.verify(makeContext(), [makeArtifact(page, mdxWithFence('ts', code))]);

    expect(result.status).toBe('fail');
    const finding = result.findings[0];
    expect(finding?.severity).toBe('error');
    expect(finding?.message).toContain('TS2322');
    expect(finding?.message).toContain('snippet line 2');
    expect(finding?.entity?.entityId).toBe(block.id);
    expect(finding?.entity?.pageId).toBe(page.id);
    expect(result.coveredEntityIds).not.toContain(block.id);
  });

  it('does not flag imports of packages that are not installed', async () => {
    const code = "import { createClient } from 'some-uninstalled-sdk';\nexport const client = createClient();";
    const block = makeBlock({ content: code, blockType: 'code-example', language: 'typescript' });
    const page = makePage({ slug: 'guide', preamble: [block] });

    const result = await codeTypecheckTsVerifier.verify(makeContext(), [makeArtifact(page, mdxWithFence('ts', code))]);

    expect(result.status).toBe('pass');
    expect(result.findings).toEqual([]);
    expect(result.coveredEntityIds).toContain(block.id);
  });

  it('ignores non-TypeScript code-example blocks', async () => {
    const code = 'echo "not typescript: const x: number = \'nope\'"';
    const block = makeBlock({ content: code, blockType: 'code-example', language: 'bash' });
    const page = makePage({ slug: 'guide', preamble: [block] });

    const result = await codeTypecheckTsVerifier.verify(makeContext(), [
      makeArtifact(page, mdxWithFence('bash', code))
    ]);

    expect(result.status).toBe('pass');
    expect(result.findings).toEqual([]);
    expect(result.coveredEntityIds).toEqual([]);
  });

  it('reports a warning (still pass) when the block content has no matching fence in the MDX', async () => {
    const block = makeBlock({ content: 'const gone = true;', blockType: 'code-example', language: 'ts' });
    const page = makePage({ slug: 'guide', preamble: [block] });

    const result = await codeTypecheckTsVerifier.verify(makeContext(), [
      makeArtifact(page, mdxWithFence('ts', 'const different = 1;'))
    ]);

    expect(result.status).toBe('pass');
    expect(result.findings[0]?.severity).toBe('warning');
    expect(result.coveredEntityIds).toEqual([]);
  });
});
