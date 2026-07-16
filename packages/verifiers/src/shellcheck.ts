import type { Finding, Severity } from '@docstube/contracts';
import type { PageArtifact, VerifierContext, VerifierDefinition } from '@docstube/plugin-sdk';
import { mapFencesByHash } from './code-typecheck-ts.ts';
import type { MdxCodeBlock } from './code-typecheck-ts.ts';
import { matchingCodeBlocks, missingFenceFinding, runVerifier } from './run-support.ts';

const verifierId = 'shellcheck';

const matchedLanguages = ['bash', 'sh'];

type ShellcheckComment = {
  line?: number;
  column?: number;
  level?: string;
  code?: number;
  message?: string;
};

const parseComments = (stdout: string): ShellcheckComment[] => {
  try {
    const parsed: unknown = JSON.parse(stdout);
    return Array.isArray(parsed) ? (parsed as ShellcheckComment[]) : [];
  } catch {
    return [];
  }
};

// Shellcheck levels error/warning/info/style; anything below "error" stays a warning so hygiene
// noise cannot look worse than it is.
const severityOf = (level: string | undefined): Severity => (level === 'error' ? 'error' : 'warning');

const commentFinding = (
  artifact: PageArtifact,
  blockId: string,
  fence: MdxCodeBlock,
  comment: ShellcheckComment
): Finding => {
  const mdxLine = typeof comment.line === 'number' ? fence.line + comment.line : fence.line;
  return {
    source: 'verifier',
    check: verifierId,
    severity: severityOf(comment.level),
    message: `SC${comment.code ?? '????'}: ${comment.message ?? 'shellcheck reported an issue'}${
      typeof comment.line === 'number' ? ` (snippet line ${comment.line})` : ''
    }`,
    entity: { version: artifact.version, locale: artifact.locale, pageId: artifact.page.id, entityId: blockId },
    file: artifact.mdxPath,
    span: [mdxLine, mdxLine],
    data: { shellcheckCode: comment.code, level: comment.level }
  };
};

export const shellcheckVerifier: VerifierDefinition = {
  id: verifierId,
  title: 'Shell snippets pass shellcheck',
  description:
    'Every bash/sh code-example block is linted with `shellcheck -s bash`. Hygiene check: a pass does not prove the snippet works (snippet-exec does), it proves the shell code is not obviously broken. Skipped when shellcheck is not installed.',
  scope: 'block',
  appliesTo: { blockTypes: ['code-example'], languages: matchedLanguages },
  localeScope: 'source-only',
  proves: false,
  verify: async (ctx: VerifierContext, pages) => {
    let shellcheckMissing = false;

    const result = await runVerifier(verifierId, async () => {
      const findings: Finding[] = [];
      const coveredEntityIds: string[] = [];

      const work = pages.flatMap((artifact) =>
        matchingCodeBlocks(artifact.page, matchedLanguages).map((block) => ({ artifact, block }))
      );
      if (work.length === 0) {
        return { findings, coveredEntityIds };
      }

      try {
        if ((await ctx.exec('shellcheck', ['--version'], { timeoutMs: 5_000 })).exitCode !== 0) {
          shellcheckMissing = true;
        }
      } catch {
        shellcheckMissing = true;
      }
      if (shellcheckMissing) {
        return { findings, coveredEntityIds };
      }

      const fencesByArtifact = new Map<PageArtifact, Map<string, MdxCodeBlock>>();
      for (const { artifact, block } of work) {
        const fences = fencesByArtifact.get(artifact) ?? mapFencesByHash(artifact.mdx);
        fencesByArtifact.set(artifact, fences);
        const fence = fences.get(block.contentHash);
        if (!fence) {
          findings.push(missingFenceFinding(verifierId, artifact, block));
          continue;
        }
        // Non-zero exit just means shellcheck found something; the JSON on stdout is the result.
        const run = await ctx.exec('shellcheck', ['-s', 'bash', '-f', 'json', '-'], {
          input: fence.code,
          timeoutMs: 30_000
        });
        const comments = parseComments(run.stdout);
        if (comments.length === 0) {
          coveredEntityIds.push(block.id);
          continue;
        }
        for (const comment of comments) {
          findings.push(commentFinding(artifact, block.id, fence, comment));
        }
      }

      return { findings, coveredEntityIds };
    });

    return shellcheckMissing ? { ...result, status: 'skipped' } : result;
  }
};
