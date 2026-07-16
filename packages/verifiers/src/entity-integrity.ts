import { listPageEntityIds, sha256HexSchema } from '@docstube/contracts';
import type { Finding } from '@docstube/contracts';
import type { PageArtifact, VerifierContext, VerifierDefinition } from '@docstube/plugin-sdk';
import { runVerifier, walkPageBlocks } from './run-support.ts';

const verifierId = 'entity-integrity';

const duplicatesOf = (values: readonly string[]): string[] => {
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      duplicated.add(value);
    }
    seen.add(value);
  }
  return [...duplicated];
};

const checkPage = (ctx: VerifierContext, artifact: PageArtifact): Finding[] => {
  const findings: Finding[] = [];
  const page = artifact.page;
  const pageEntity = { version: artifact.version, locale: artifact.locale, pageId: page.id };
  const baseFinding = { source: 'verifier' as const, check: verifierId, file: artifact.mdxPath };

  for (const id of duplicatesOf(listPageEntityIds(page))) {
    findings.push({
      ...baseFinding,
      severity: 'error',
      message: `duplicate entity id "${id}" in page "${page.slug}" — entity ids must be unique within a page tree`,
      entity: pageEntity
    });
  }

  for (const anchor of duplicatesOf(page.sections.map((section) => section.anchor))) {
    findings.push({
      ...baseFinding,
      severity: 'error',
      message: `duplicate section anchor "${anchor}" in page "${page.slug}" — anchors must be unique within a page`,
      entity: pageEntity
    });
  }

  for (const { block } of walkPageBlocks(page)) {
    const blockEntity = { ...pageEntity, entityId: block.id };

    if (!sha256HexSchema.safeParse(block.contentHash).success) {
      findings.push({
        ...baseFinding,
        severity: 'error',
        message: `block ${block.id} has an invalid contentHash "${block.contentHash}" — expected 64 lowercase hex chars (sha256)`,
        entity: blockEntity
      });
    }

    if (!block.blockType.startsWith('component:')) {
      continue;
    }
    const registered = ctx.registry.get(block.blockType);
    if (!registered) {
      findings.push({
        ...baseFinding,
        severity: 'warning',
        message: `block ${block.id} uses unknown block type "${block.blockType}", guarantee capped — component is not in the registry`,
        entity: blockEntity
      });
      continue;
    }
    const metadataResult = registered.propsSchema.safeParse(block.metadata);
    if (!metadataResult.success) {
      const issues = metadataResult.error.issues
        .map((issue) => `${issue.path.length > 0 ? issue.path.map(String).join('.') : '<root>'}: ${issue.message}`)
        .join('; ');
      findings.push({
        ...baseFinding,
        severity: 'error',
        message: `block ${block.id} metadata does not match the "${block.blockType}" schema: ${issues}`,
        entity: blockEntity
      });
    }
  }

  return findings;
};

export const entityIntegrityVerifier: VerifierDefinition = {
  id: verifierId,
  title: 'Entity tree integrity',
  description:
    'Structural hygiene of the page entity tree: unique entity ids, unique section anchors, valid sha256 content hashes, and component block metadata that validates against the block-type registry.',
  scope: 'page',
  localeScope: 'per-locale',
  proves: false,
  verify: (ctx, pages) =>
    runVerifier(verifierId, async () => ({
      findings: pages.flatMap((artifact) => checkPage(ctx, artifact)),
      coveredEntityIds: pages.map((artifact) => artifact.page.id)
    }))
};
