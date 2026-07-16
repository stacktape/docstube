import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { typecheckSnippet } from './snippet-typecheck.ts';

const ctx = { repoRoot: fileURLToPath(new URL('../test-fixtures/sample-lib', import.meta.url)) };

describe('typecheckSnippet', () => {
  it('reports a type error as an error finding with a span', async () => {
    const findings = await typecheckSnippet(`const value: number = 'not a number';\n`, ctx);
    expect(findings.length).toBeGreaterThan(0);
    const finding = findings[0];
    expect(finding).toMatchObject({ source: 'verifier', check: 'code-typecheck-ts', severity: 'error' });
    expect(finding?.message).toContain('not assignable');
    expect(finding?.span).toEqual([1, 1]);
  });

  it('returns no findings for a clean snippet', async () => {
    const findings = await typecheckSnippet(
      'export const add = (a: number, b: number): number => a + b;\nexport const sum = add(1, 2);\n',
      ctx
    );
    expect(findings).toEqual([]);
  });

  it('does not fail snippets that import uninstalled packages', async () => {
    const findings = await typecheckSnippet(
      `import { createClient } from 'definitely-not-installed-package';\n\nexport const client = createClient();\n`,
      ctx
    );
    expect(findings).toEqual([]);
  });

  it('still reports real errors inside snippets that also import uninstalled packages', async () => {
    const findings = await typecheckSnippet(
      `import { createClient } from 'definitely-not-installed-package';\n\nconst n: number = 'nope';\nexport const client = createClient();\n`,
      ctx
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('error');
  });
});
