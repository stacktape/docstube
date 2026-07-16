import { sourceKeySchema } from '@docstube/contracts';
import { describe, expect, it } from 'vitest';
import { hashSymbol, normalizeDeclaration } from './symbol-hash.ts';

const baseDeclaration = `
/**
 * Retries an operation.
 */
export function retry(operation: () => Promise<void>, retries = 3): Promise<void> {
  // inner comment
  return runWithRetries(operation, retries);
}
`;

const reformattedDeclaration = `
export function retry(
  operation: () => Promise<void>,
  retries = 3
): Promise<void> {
  return runWithRetries(operation,   retries);
}
`;

const renamedDeclaration = baseDeclaration.replaceAll('retry', 'retryWithBackoff');

const hashOf = (declaration: string, containerPath: string[] = ['src', 'retry']): string =>
  hashSymbol({
    lang: 'ts',
    kind: 'function',
    containerPath,
    normalizedDeclaration: normalizeDeclaration(declaration)
  });

describe('normalizeDeclaration', () => {
  it('strips comments and collapses whitespace', () => {
    const normalized = normalizeDeclaration(baseDeclaration);
    expect(normalized).not.toContain('Retries an operation');
    expect(normalized).not.toContain('inner comment');
    expect(normalized).not.toContain('  ');
    expect(normalized.startsWith('export function retry(')).toBe(true);
  });

  it('is stable across CRLF and trailing whitespace', () => {
    const crlf = baseDeclaration.replaceAll('\n', '\r\n');
    expect(normalizeDeclaration(crlf)).toBe(normalizeDeclaration(baseDeclaration));
  });
});

describe('hashSymbol', () => {
  it('returns a valid sourceKey', () => {
    expect(() => sourceKeySchema.parse(hashOf(baseDeclaration))).not.toThrow();
    expect(hashOf(baseDeclaration).startsWith('ts:')).toBe(true);
  });

  it('ignores comment and whitespace changes', () => {
    expect(hashOf(reformattedDeclaration)).toBe(hashOf(baseDeclaration));
  });

  it('changes when the symbol is renamed', () => {
    expect(hashOf(renamedDeclaration)).not.toBe(hashOf(baseDeclaration));
  });

  it('changes with the container path', () => {
    expect(hashOf(baseDeclaration, ['src', 'other-module'])).not.toBe(hashOf(baseDeclaration));
  });

  it('changes with the kind', () => {
    const normalizedDeclaration = normalizeDeclaration(baseDeclaration);
    const asFunction = hashSymbol({ lang: 'ts', kind: 'function', containerPath: [], normalizedDeclaration });
    const asMethod = hashSymbol({ lang: 'ts', kind: 'method', containerPath: [], normalizedDeclaration });
    expect(asMethod).not.toBe(asFunction);
  });
});
