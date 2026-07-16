import type { BlockEntity, Finding, PageEntity, SectionEntity, VerifierRunResult } from '@docstube/contracts';
import type { PageArtifact } from '@docstube/plugin-sdk';

export const verifiersPluginName = '@docstube/verifiers';

export type VerifyOutcome = { findings: Finding[]; coveredEntityIds: string[] };

// Shared result assembly: 'pass' when no error-severity findings (warnings alone still pass),
// 'fail' when any error finding, 'error' strictly for internal crashes — verify never throws.
export const runVerifier = async (
  verifierId: string,
  body: () => Promise<VerifyOutcome>
): Promise<VerifierRunResult> => {
  const startedAt = performance.now();
  try {
    const { findings, coveredEntityIds } = await body();
    return {
      verifier: verifierId,
      plugin: verifiersPluginName,
      status: findings.some((finding) => finding.severity === 'error') ? 'fail' : 'pass',
      findings,
      coveredEntityIds,
      durationMs: performance.now() - startedAt
    };
  } catch (error) {
    return {
      verifier: verifierId,
      plugin: verifiersPluginName,
      status: 'error',
      findings: [
        {
          source: 'verifier',
          check: verifierId,
          severity: 'error',
          message: `internal verifier crash: ${error instanceof Error ? error.message : String(error)}`
        }
      ],
      coveredEntityIds: [],
      durationMs: performance.now() - startedAt
    };
  }
};

export type PageBlock = { block: BlockEntity; section: SectionEntity | undefined };

export const walkPageBlocks = (page: PageEntity): PageBlock[] => [
  ...page.preamble.map((block) => ({ block, section: undefined })),
  ...page.sections.flatMap((section) => section.blocks.map((block) => ({ block, section })))
];

// Code-example blocks whose (lowercased) language is in the verifier's matched set.
export const matchingCodeBlocks = (page: PageEntity, languages: string[]): BlockEntity[] =>
  walkPageBlocks(page)
    .map(({ block }) => block)
    .filter((block) => block.blockType === 'code-example' && languages.includes((block.language ?? '').toLowerCase()));

// Shared warning for a block entity whose contentHash matches no fenced code block in the MDX —
// the snippet cannot be located, so it stays unverified (warning, not a gate failure).
export const missingFenceFinding = (verifierId: string, artifact: PageArtifact, block: BlockEntity): Finding => ({
  source: 'verifier',
  check: verifierId,
  severity: 'warning',
  message: `code-example block ${block.id} has no fenced code block in the MDX matching its contentHash — snippet not verified`,
  entity: { version: artifact.version, locale: artifact.locale, pageId: artifact.page.id, entityId: block.id },
  file: artifact.mdxPath
});
