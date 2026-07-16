import { compile } from '@mdx-js/mdx';
import type { Finding } from '@docstube/contracts';
import type { PageArtifact, VerifierDefinition } from '@docstube/plugin-sdk';
import { runVerifier } from './run-support.ts';

const verifierId = 'mdx-compile';

const pointOf = (value: unknown): { line?: number; column?: number } => {
  if (!value || typeof value !== 'object') {
    return {};
  }
  const record = value as Record<string, unknown>;
  return {
    line: typeof record.line === 'number' ? record.line : undefined,
    column: typeof record.column === 'number' ? record.column : undefined
  };
};

// @mdx-js/mdx throws VFileMessage-shaped errors: line/column directly, or a place point/position.
const errorPoint = (error: unknown): { line?: number; column?: number } => {
  const direct = pointOf(error);
  if (direct.line !== undefined) {
    return direct;
  }
  if (error && typeof error === 'object' && 'place' in error) {
    const place = (error as { place?: unknown }).place;
    if (place && typeof place === 'object' && 'start' in place) {
      return pointOf((place as { start?: unknown }).start);
    }
    return pointOf(place);
  }
  return {};
};

// Some micromark errors (e.g. unclosed JSX tags) only carry their position as a trailing
// "(line:column-line:column)" in the reason text, with line/place left undefined.
const pointFromReason = (reason: string): { line?: number; column?: number } => {
  const match = /\((\d+):(\d+)(?:-\d+:\d+)?\)\s*$/u.exec(reason);
  return match ? { line: Number(match[1]), column: Number(match[2]) } : {};
};

const compileErrorFinding = (artifact: PageArtifact, error: unknown): Finding => {
  const reason =
    error && typeof error === 'object' && typeof (error as { reason?: unknown }).reason === 'string'
      ? (error as { reason: string }).reason
      : error instanceof Error
        ? error.message
        : String(error);
  const fromError = errorPoint(error);
  const { line, column } = fromError.line === undefined ? pointFromReason(reason) : fromError;
  const position =
    line === undefined ? '' : column === undefined ? ` at line ${line}` : ` at line ${line}, column ${column}`;
  return {
    source: 'verifier',
    check: verifierId,
    severity: 'error',
    message: `MDX failed to compile${position}: ${reason}`,
    entity: { version: artifact.version, locale: artifact.locale, pageId: artifact.page.id },
    file: artifact.mdxPath,
    span: line === undefined ? undefined : [line, line]
  };
};

export const mdxCompileVerifier: VerifierDefinition = {
  id: verifierId,
  title: 'MDX compiles',
  description:
    'Every generated page must compile as MDX — catches syntax errors and unclosed JSX. Unknown JSX component names are entity-integrity territory, not a compile failure.',
  scope: 'page',
  localeScope: 'per-locale',
  proves: false,
  verify: (_ctx, pages) =>
    runVerifier(verifierId, async () => {
      const findings: Finding[] = [];
      for (const artifact of pages) {
        try {
          await compile(artifact.mdx);
        } catch (error) {
          findings.push(compileErrorFinding(artifact, error));
        }
      }
      return { findings, coveredEntityIds: pages.map((artifact) => artifact.page.id) };
    })
};
