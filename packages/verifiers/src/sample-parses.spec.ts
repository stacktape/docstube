import { describe, expect, it } from 'vitest';
import { parseJsonSample, parseYamlSample, sampleParsesVerifier } from './sample-parses.ts';
import { makeArtifact, makeBlock, makeClaim, makeContext, makePage, makeSection } from './test-support.ts';

const mdxWithFence = (lang: string, code: string): string => `# Title\n\n\`\`\`${lang}\n${code}\n\`\`\`\n`;

describe('parseJsonSample', () => {
  it('locates the first syntax error with line and column', () => {
    const errors = parseJsonSample('{\n  "name": "docs",\n  "count": ,\n}');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.line).toBe(3);
    expect(errors[0]?.column).toBeGreaterThan(0);
  });

  it('accepts valid JSON', () => {
    expect(parseJsonSample('{"a": [1, 2.5, true, null], "b": "x"}')).toEqual([]);
  });

  it('flags trailing content', () => {
    const errors = parseJsonSample('{}\n{}');
    expect(errors[0]?.message).toContain('trailing content');
    expect(errors[0]?.line).toBe(2);
  });
});

describe('parseYamlSample', () => {
  it('locates YAML parse errors', () => {
    const errors = parseYamlSample('name: docs\n  bad: [1, 2\n');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.line).toBeGreaterThanOrEqual(1);
    expect(errors[0]?.column).toBeGreaterThanOrEqual(1);
  });

  it('accepts valid YAML', () => {
    expect(parseYamlSample('name: docs\nitems:\n  - one\n  - two\n')).toEqual([]);
  });
});

describe('sample-parses', () => {
  it('fails a malformed JSON block with a positioned error finding', async () => {
    const code = '{\n  "port": 8080,\n  "host": \n}';
    const block = makeBlock({ content: code, blockType: 'code-example', language: 'json' });
    const page = makePage({ slug: 'config', preamble: [block] });

    const result = await sampleParsesVerifier.verify(makeContext(), [makeArtifact(page, mdxWithFence('json', code))]);

    expect(result.status).toBe('fail');
    const finding = result.findings[0];
    expect(finding?.severity).toBe('error');
    expect(finding?.message).toMatch(/line \d+, column \d+/u);
    expect(finding?.entity?.entityId).toBe(block.id);
    expect(finding?.span?.[0]).toBeGreaterThan(3);
    expect(result.coveredEntityIds).toEqual([]);
  });

  it('fails a malformed YAML block with a positioned error finding', async () => {
    const code = 'services:\n  api:\n   ports: [80, 443\n';
    const block = makeBlock({ content: code, blockType: 'code-example', language: 'yaml' });
    const page = makePage({ slug: 'config', preamble: [block] });

    const result = await sampleParsesVerifier.verify(makeContext(), [makeArtifact(page, mdxWithFence('yaml', code))]);

    expect(result.status).toBe('fail');
    expect(result.findings[0]?.severity).toBe('error');
    expect(result.findings[0]?.message).toMatch(/line \d+, column \d+/u);
  });

  it('passes well-formed samples and covers blocks and claims, including yml', async () => {
    const jsonCode = '{"name": "docstube"}';
    const ymlCode = 'name: docstube\nversion: 1\n';
    const jsonClaim = makeClaim('the config sample is valid');
    const jsonBlock = makeBlock({
      content: jsonCode,
      blockType: 'code-example',
      language: 'json',
      claims: [jsonClaim]
    });
    const ymlBlock = makeBlock({ content: ymlCode, blockType: 'code-example', language: 'yml' });
    const page = makePage({ slug: 'config', sections: [makeSection({ anchor: 's', blocks: [jsonBlock, ymlBlock] })] });
    const mdx = `${mdxWithFence('json', jsonCode)}\n${mdxWithFence('yml', ymlCode)}`;

    const result = await sampleParsesVerifier.verify(makeContext(), [makeArtifact(page, mdx)]);

    expect(result.status).toBe('pass');
    expect(result.findings).toEqual([]);
    expect(result.coveredEntityIds).toContain(jsonBlock.id);
    expect(result.coveredEntityIds).toContain(jsonClaim.id);
    expect(result.coveredEntityIds).toContain(ymlBlock.id);
  });

  it('ignores non-sample languages', async () => {
    const code = 'not: valid: json: or: sensible';
    const block = makeBlock({ content: code, blockType: 'code-example', language: 'ts' });
    const page = makePage({ slug: 'config', preamble: [block] });

    const result = await sampleParsesVerifier.verify(makeContext(), [makeArtifact(page, mdxWithFence('ts', code))]);

    expect(result.status).toBe('pass');
    expect(result.findings).toEqual([]);
    expect(result.coveredEntityIds).toEqual([]);
  });

  it('reports a warning (still pass) when the block has no matching fence', async () => {
    const block = makeBlock({ content: '{"gone": true}', blockType: 'code-example', language: 'json' });
    const page = makePage({ slug: 'config', preamble: [block] });

    const result = await sampleParsesVerifier.verify(makeContext(), [
      makeArtifact(page, mdxWithFence('json', '{"different": 1}'))
    ]);

    expect(result.status).toBe('pass');
    expect(result.findings[0]?.severity).toBe('warning');
  });
});
