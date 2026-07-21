import { describe, expect, it } from 'vitest';
import { detectFailureCapableAssertion, snippetRuntimeOf } from './assertion-detection.ts';

describe('detectFailureCapableAssertion — js/ts', () => {
  it('accepts assert/expect/throw/nonzero-exit constructs', () => {
    expect(detectFailureCapableAssertion('ts', "assert(typeof retry === 'function');")).toBe(true);
    expect(detectFailureCapableAssertion('js', 'assert.strictEqual(retries, 3);')).toBe(true);
    expect(detectFailureCapableAssertion('ts', 'expect(retries).toBe(3);')).toBe(true);
    expect(detectFailureCapableAssertion('ts', "if (retries !== 3) throw new Error('wrong');")).toBe(true);
    expect(detectFailureCapableAssertion('js', 'if (bad) process.exit(1);')).toBe(true);
  });

  it("rejects the Sol probe: console.log('ok') is trivially assertion-free", () => {
    expect(detectFailureCapableAssertion('ts', "console.log('ok');")).toBe(false);
    expect(detectFailureCapableAssertion('js', "console.log('done');\nconsole.info(retries);")).toBe(false);
  });

  it('rejects console.assert (it logs and returns; the process still exits 0)', () => {
    expect(detectFailureCapableAssertion('js', 'console.assert(retries === 3);')).toBe(false);
  });

  it('never counts constructs inside string literals or comments', () => {
    expect(detectFailureCapableAssertion('js', 'console.log("assert(x) throws");')).toBe(false);
    expect(detectFailureCapableAssertion('js', '// assert(x)\nconsole.log(1);')).toBe(false);
    expect(detectFailureCapableAssertion('js', '/* throw */ console.log(1);')).toBe(false);
    expect(detectFailureCapableAssertion('js', 'console.log(`use throw here`);')).toBe(false);
  });

  it('rejects process.exit(0) — a success exit can never fail the claim', () => {
    expect(detectFailureCapableAssertion('js', 'process.exit(0);')).toBe(false);
  });
});

describe('detectFailureCapableAssertion — bash', () => {
  it('accepts test conditionals, grep -q, and nonzero exits', () => {
    expect(detectFailureCapableAssertion('bash', '[ -f docstube.yml ]')).toBe(true);
    expect(detectFailureCapableAssertion('sh', '[[ "$out" == *ok* ]]')).toBe(true);
    expect(detectFailureCapableAssertion('bash', 'test -n "$PATH"')).toBe(true);
    expect(detectFailureCapableAssertion('bash', 'docstube --help | grep -q generate')).toBe(true);
    expect(detectFailureCapableAssertion('bash', 'command -v docstube || exit 1')).toBe(true);
  });

  it('rejects echo-only snippets and quoted/commented constructs', () => {
    expect(detectFailureCapableAssertion('bash', 'echo ok')).toBe(false);
    expect(detectFailureCapableAssertion('bash', "echo 'run test -n later'")).toBe(false);
    expect(detectFailureCapableAssertion('bash', '# test -n "$x"\necho done')).toBe(false);
    expect(detectFailureCapableAssertion('bash', 'exit 0')).toBe(false);
  });
});

describe('detectFailureCapableAssertion — unknown languages', () => {
  it('is unsure, therefore false — no evidence', () => {
    expect(detectFailureCapableAssertion('python', 'assert retries == 3')).toBe(false);
    expect(detectFailureCapableAssertion('', 'assert(1)')).toBe(false);
  });
});

describe('snippetRuntimeOf', () => {
  it('records the actual runtime: bash for bash/sh, node otherwise', () => {
    expect(snippetRuntimeOf('bash')).toBe('bash');
    expect(snippetRuntimeOf('sh')).toBe('bash');
    expect(snippetRuntimeOf('ts')).toBe('node');
    expect(snippetRuntimeOf('javascript')).toBe('node');
  });
});
