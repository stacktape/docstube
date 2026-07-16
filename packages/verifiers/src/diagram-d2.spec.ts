import { describe, expect, it } from 'vitest';
import { codemapSchema } from '@docstube/contracts';
import type { VerifierContext } from '@docstube/plugin-sdk';
import { diagramD2Verifier, extractD2Nodes, groundD2Node } from './diagram-d2.ts';
import { makeArtifact, makeBlock, makeClaim, makeContext, makePage, makeSection } from './test-support.ts';

const codemap = codemapSchema.parse({
  schemaVersion: 1,
  commit: 'a'.repeat(40),
  symbols: [
    {
      hash: `ts:${'1'.repeat(64)}`,
      lang: 'ts',
      kind: 'function',
      name: 'greet',
      containerPath: ['src', 'greeter'],
      file: 'src/greeter.ts',
      span: [1, 5],
      visibility: 'public',
      project: '.'
    },
    {
      hash: `ts:${'2'.repeat(64)}`,
      lang: 'ts',
      kind: 'class',
      name: 'RetryQueue',
      containerPath: ['src', 'queue'],
      file: 'src/queue.ts',
      span: [1, 40],
      visibility: 'public',
      project: '.'
    }
  ]
});

const ctxWithCodemap = (): VerifierContext => ({ ...makeContext(), codemap });

const mdxWithFence = (info: string, code: string): string => `# Title\n\n\`\`\`${info}\n${code}\n\`\`\`\n`;

const pageWithDiagram = (code: string) => {
  const claim = makeClaim('the architecture looks like this');
  const block = makeBlock({ content: code, blockType: 'code-example', language: 'd2', claims: [claim] });
  const page = makePage({ slug: 'architecture', sections: [makeSection({ anchor: 'overview', blocks: [block] })] });
  return { block, claim, page };
};

describe('extractD2Nodes', () => {
  it('extracts connection endpoints, declarations, and nested container paths', () => {
    const nodes = extractD2Nodes(
      [
        '# comment',
        'greet -> RetryQueue: enqueues',
        'api: {',
        '  server: The Server',
        '  style: {',
        '    fill: red',
        '  }',
        '}',
        'RetryQueue.shape: rectangle'
      ].join('\n')
    );
    const paths = nodes.map((node) => node.path).toSorted();
    expect(paths).toEqual(['RetryQueue', 'api', 'api.server', 'greet']);
    expect(nodes.find((node) => node.path === 'api.server')?.label).toBe('The Server');
  });
});

describe('groundD2Node', () => {
  it('grounds by name, dotted tail, and label — case-insensitively', () => {
    expect(groundD2Node({ path: 'greet', line: 1 }, codemap)).toBe(true);
    expect(groundD2Node({ path: 'queue.RetryQueue', line: 1 }, codemap)).toBe(true);
    expect(groundD2Node({ path: 'box', label: 'retryqueue', line: 1 }, codemap)).toBe(true);
    expect(groundD2Node({ path: 'Database', line: 1 }, codemap)).toBe(false);
  });
});

describe('diagram-d2 verifier', () => {
  it('proves a compiled, fully grounded diagram', async () => {
    const code = 'greet -> RetryQueue: enqueues';
    const { block, claim, page } = pageWithDiagram(code);
    const result = await diagramD2Verifier.verify(ctxWithCodemap(), [makeArtifact(page, mdxWithFence('d2', code))]);
    expect(result.status).toBe('pass');
    expect(result.findings).toEqual([]);
    expect(result.coveredEntityIds).toEqual([block.id, claim.id]);
  }, 30_000);

  it('fails an ungrounded node with an error finding, downgraded to warning by `loose`', async () => {
    const code = 'greet -> Database: writes';
    const { page } = pageWithDiagram(code);

    const strict = await diagramD2Verifier.verify(ctxWithCodemap(), [makeArtifact(page, mdxWithFence('d2', code))]);
    expect(strict.status).toBe('fail');
    expect(strict.findings[0]?.severity).toBe('error');
    expect(strict.findings[0]?.message).toContain('Database');
    expect(strict.coveredEntityIds).toEqual([]);

    const loosePage = pageWithDiagram(code);
    const loose = await diagramD2Verifier.verify(ctxWithCodemap(), [
      makeArtifact(loosePage.page, mdxWithFence('d2 loose', code))
    ]);
    expect(loose.status).toBe('pass');
    expect(loose.findings[0]?.severity).toBe('warning');
    // Visible but not proven: the block stays uncovered.
    expect(loose.coveredEntityIds).toEqual([]);
  }, 30_000);

  it('fails a diagram that does not compile', async () => {
    const code = 'greet -> {';
    const { page } = pageWithDiagram(code);
    const result = await diagramD2Verifier.verify(ctxWithCodemap(), [makeArtifact(page, mdxWithFence('d2', code))]);
    expect(result.status).toBe('fail');
    expect(result.findings[0]?.message).toContain('D2 compile failed');
  }, 30_000);
});
