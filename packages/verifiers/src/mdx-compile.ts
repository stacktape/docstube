import { compile } from '@mdx-js/mdx';
import { parse as parseYaml } from 'yaml';
import { splitFrontmatter } from '@docstube/contracts';
import type { Finding, FrontmatterSplit } from '@docstube/contracts';
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
const trailingPoint = /\s*\((\d+):(\d+)(?:-\d+:\d+)?\)\s*$/u;
const pointFromReason = (reason: string): { line?: number; column?: number } => {
  const match = trailingPoint.exec(reason);
  return match ? { line: Number(match[1]), column: Number(match[2]) } : {};
};

// Compiler coordinates are BODY-relative (we compile the body, not the raw file), so every
// position — including the one micromark bakes into the reason text — is shifted back onto source
// lines before a human reads it. The raw trailing "(line:column)" is dropped rather than left in
// the message, because an unshifted duplicate next to a shifted position points at the wrong line.
const compileErrorFinding = (artifact: PageArtifact, error: unknown, lineOffset: number): Finding => {
  const raw =
    error && typeof error === 'object' && typeof (error as { reason?: unknown }).reason === 'string'
      ? (error as { reason: string }).reason
      : error instanceof Error
        ? error.message
        : String(error);
  const fromError = errorPoint(error);
  const bodyPoint = fromError.line === undefined ? pointFromReason(raw) : fromError;
  const reason = raw.replace(trailingPoint, '');
  const line = bodyPoint.line === undefined ? undefined : bodyPoint.line + lineOffset;
  const column = bodyPoint.column;
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

// The body is always a suffix of the raw source (the splitter only ever removes a prefix: BOM,
// blank lines above the delimiter, and the frontmatter block), so the lines the compiler never saw
// are exactly the newlines in that prefix.
const bodyLineOffset = (source: string, body: string): number => {
  const prefixLength = source.length - body.length;
  return prefixLength <= 0 ? 0 : source.slice(0, prefixLength).split('\n').length - 1;
};

// YAML diagnostics are FRONTMATTER-relative — the parser only ever sees the fenced block — so a
// position it reports (structured in `linePos`, and repeated in its message text) is shifted onto
// SOURCE lines before a human reads it, exactly as compiler positions are. Leaving them unshifted
// next to a hardcoded span pointed at two different, both-wrong lines.
const yamlPositionInMessage = /\s*at line (\d+), column (\d+):?\s*$/u;

const yamlErrorPoint = (error: unknown, reason: string): { line: number; column: number | undefined } | undefined => {
  const linePos = error && typeof error === 'object' ? (error as { linePos?: unknown }).linePos : undefined;
  const start = Array.isArray(linePos) ? (linePos[0] as { line?: unknown; col?: unknown } | undefined) : undefined;
  if (start !== undefined && typeof start.line === 'number') {
    return { line: start.line, column: typeof start.col === 'number' ? start.col : undefined };
  }
  const match = yamlPositionInMessage.exec(reason);
  return match ? { line: Number(match[1]), column: Number(match[2]) } : undefined;
};

// The frontmatter block is a slice of the raw source: the BOM and blank lines the canonical split
// removed, plus the opening delimiter line (frontmatterOffset, from the shared splitter). The lines
// the YAML parser never saw are exactly the newlines in that prefix.
const frontmatterLineOffset = (source: string, split: FrontmatterSplit): number => {
  const prefixLength = source.length - split.canonicalSource.length + split.frontmatterOffset;
  return prefixLength <= 0 ? 0 : source.slice(0, prefixLength).split('\n').length - 1;
};

// remark treats the frontmatter fence as opaque, so @mdx-js/mdx compiles pages whose frontmatter
// is broken YAML — and those pages crash any downstream YAML consumer (live-hit: an unquoted
// description containing ": "). Validate the fenced block ourselves, using the shared splitter so
// the verifier vets exactly the block emission will vet (wave 2b close).
const frontmatterFinding = (
  artifact: PageArtifact,
  split: FrontmatterSplit,
  lineOffset: number
): Finding | undefined => {
  if (!split.hadFrontmatter) {
    return undefined;
  }
  try {
    parseYaml(split.frontmatter);
    return undefined;
  } catch (error) {
    const raw = error instanceof Error ? (error.message.split('\n')[0] ?? 'invalid YAML') : 'invalid YAML';
    const point = yamlErrorPoint(error, raw);
    // The parser's own position text is REPLACED, not kept beside the shifted one: two conflicting
    // line numbers in one message point a human at the wrong line half the time.
    const reason = raw.replace(yamlPositionInMessage, '');
    // No reported position (a shape this yaml version does not carry one for): the block's own
    // first line is the honest span, and the message stays silent about the position rather than
    // inventing one.
    const line = (point?.line ?? 1) + lineOffset;
    const position =
      point === undefined
        ? ''
        : point.column === undefined
          ? ` at line ${line}`
          : ` at line ${line}, column ${point.column}`;
    return {
      source: 'verifier',
      check: verifierId,
      severity: 'error',
      message: `frontmatter is not valid YAML${position} (${reason}) — quote values that contain ":" or "#"`,
      entity: { version: artifact.version, locale: artifact.locale, pageId: artifact.page.id },
      file: artifact.mdxPath,
      span: [line, line]
    };
  }
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
        // Frontmatter is YAML, not MDX. Compiling the raw file made the compiler read it as prose,
        // so a correct authored value like `description: "Use <Widget> literally"` failed as an
        // unclosed JSX tag on a page Astro accepts. Each half is checked by its own parser.
        const split = splitFrontmatter(artifact.mdx);
        const frontmatterError = frontmatterFinding(artifact, split, frontmatterLineOffset(artifact.mdx, split));
        if (frontmatterError) {
          findings.push(frontmatterError);
        }
        try {
          await compile(split.body);
        } catch (error) {
          findings.push(compileErrorFinding(artifact, error, bodyLineOffset(artifact.mdx, split.body)));
        }
      }
      return { findings, coveredEntityIds: pages.map((artifact) => artifact.page.id) };
    })
};
