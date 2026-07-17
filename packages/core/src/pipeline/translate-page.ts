import type { PageArtifact } from '@docstube/plugin-sdk';
import type { AgentTaskSpec, Finding, PageEntity, PageShard } from '@docstube/contracts';
import { agentTaskSpecSchema, idPrefixes, mintId } from '@docstube/contracts';
import { extractPageEntity } from '../entities/extract-entities.ts';
import { CoreError } from '../errors.ts';
import type { PageRunContext } from './page-runner.ts';
import { contentRelativePath, unwrapMdxFence } from './page-runner.ts';
import { errorFindings, recomputeRollups, runVerifiers } from './verify-page.ts';

// The i18n path (PRODUCT §4.1): declared locale list, source locale is truth, locale is an
// address dimension — a translated entity keeps the SAME id as its source entity (§3.3), so the
// translated tree must be structurally identical to the source tree. Translations pass through
// the per-locale verifiers ("verified translations"); source-only checks never rerun.

const translatorSystemPrompt = (sourceLocale: string, targetLocale: string): string =>
  [
    `You translate developer documentation from "${sourceLocale}" to "${targetLocale}".`,
    '',
    'Hard rules:',
    '- Preserve the document structure EXACTLY: same headings in the same order, same paragraphs, same lists,',
    '  same code blocks, same components with the same props. Translate content, never structure.',
    '- NEVER translate: code blocks (byte-identical), identifiers, CLI commands, file paths, URLs, component names',
    '  and prop names, frontmatter KEYS.',
    '- DO translate: prose, headings, table cells, list items, frontmatter title/description VALUES, quoted UI text.',
    '- Output pure MDX only — no fences around the document, no commentary.'
  ].join('\n');

export const buildTranslatePageTask = (input: {
  sourceLocale: string;
  targetLocale: string;
  mdx: string;
  slug: string;
}): AgentTaskSpec =>
  agentTaskSpecSchema.parse({
    id: mintId(idPrefixes.task),
    kind: 'translate-page',
    systemPrompt: translatorSystemPrompt(input.sourceLocale, input.targetLocale),
    userPrompt: [`Translate the page "${input.slug}" to ${input.targetLocale}.`, '', input.mdx].join('\n'),
    tools: [],
    workspace: { readRoots: ['.'], writableRoots: [] },
    budget: { maxTurns: 4, maxToolCalls: 4 },
    output: { type: 'mdx' }
  });

const alignBlocks = (
  sourceBlocks: PageEntity['preamble'],
  translatedBlocks: PageEntity['preamble'],
  where: string
): PageEntity['preamble'] | string => {
  if (sourceBlocks.length !== translatedBlocks.length) {
    return `${where}: block count ${translatedBlocks.length} != ${sourceBlocks.length}`;
  }
  const aligned: PageEntity['preamble'] = [];
  for (const [index, sourceBlock] of sourceBlocks.entries()) {
    const translatedBlock = translatedBlocks[index];
    if (translatedBlock === undefined || translatedBlock.blockType !== sourceBlock.blockType) {
      return `${where}[${index}]: block type ${translatedBlock?.blockType ?? 'missing'} != ${sourceBlock.blockType}`;
    }
    // Untranslatable blocks (code) must be byte-identical → they keep the source guarantee.
    const guarantee = translatedBlock.contentHash === sourceBlock.contentHash ? sourceBlock.guarantee : 'scored';
    aligned.push({
      ...translatedBlock,
      id: sourceBlock.id,
      guarantee,
      claims: translatedBlock.contentHash === sourceBlock.contentHash ? sourceBlock.claims : [],
      provenance: sourceBlock.provenance
    });
  }
  return aligned;
};

// Locale is an address dimension: copy the source ids onto the structurally-matching translated
// tree. A structure mismatch is a hard finding — ids cannot be aligned, so the translation is
// rejected (retried, then flagged), never shipped with fresh ids.
export const alignTranslatedEntities = (
  source: PageEntity,
  translated: PageEntity
): { page: PageEntity } | { mismatch: string } => {
  if (translated.preamble.length !== source.preamble.length) {
    return { mismatch: `preamble block count ${translated.preamble.length} != ${source.preamble.length}` };
  }
  if (translated.sections.length !== source.sections.length) {
    return { mismatch: `section count ${translated.sections.length} != ${source.sections.length}` };
  }

  const preamble = alignBlocks(source.preamble, translated.preamble, 'preamble');
  if (typeof preamble === 'string') {
    return { mismatch: preamble };
  }
  const sections: PageEntity['sections'] = [];
  for (const [index, sourceSection] of source.sections.entries()) {
    const translatedSection = translated.sections[index];
    if (translatedSection === undefined || translatedSection.level !== sourceSection.level) {
      return { mismatch: `section[${index}]: level mismatch` };
    }
    const blocks = alignBlocks(sourceSection.blocks, translatedSection.blocks, `section[${index}]`);
    if (typeof blocks === 'string') {
      return { mismatch: blocks };
    }
    sections.push({ ...translatedSection, id: sourceSection.id, blocks, guarantee: sourceSection.guarantee });
  }
  // Roll-ups recompute from the ALIGNED blocks: translated prose was downgraded to 'scored' above,
  // so copying the source page/section levels would advertise a guarantee the translation's own
  // blocks no longer support.
  return {
    page: recomputeRollups({
      ...translated,
      id: source.id,
      slug: source.slug,
      preamble,
      sections,
      guarantee: source.guarantee,
      provenance: source.provenance
    })
  };
};

export type TranslationOutcome = {
  locale: string;
  slug: string;
  status: 'passed' | 'flagged';
  findings: Finding[];
};

// Translate one shipped source artifact into every target locale. Returns per-locale artifacts,
// shards, and outcomes; the caller persists them.
export const translateArtifact = async (
  ctx: PageRunContext,
  sourceArtifact: PageArtifact
): Promise<Array<{ outcome: TranslationOutcome; artifact: PageArtifact; shard: PageShard }>> => {
  const results: Array<{ outcome: TranslationOutcome; artifact: PageArtifact; shard: PageShard }> = [];
  const maxAttempts = 2;

  for (const targetLocale of ctx.config.locales.targets) {
    let findings: Finding[] = [];
    let lastArtifact: PageArtifact | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const task = buildTranslatePageTask({
        sourceLocale: ctx.locale,
        targetLocale,
        mdx: sourceArtifact.mdx,
        slug: sourceArtifact.page.slug
      });
      await ctx.journal.append({ type: 'task-started', taskId: task.id, pageId: sourceArtifact.page.id });
      const transcript = await ctx.options.runTask(task);
      await ctx.journal.append({
        type: 'task-completed',
        taskId: task.id,
        pageId: sourceArtifact.page.id,
        usage: transcript.usage
      });
      ctx.costTracker.add(transcript.usage);
      if (transcript.result?.type !== 'mdx') {
        throw new CoreError(
          'pipeline-failed',
          `translate-page task for "${sourceArtifact.page.slug}" (${targetLocale}) returned no MDX`
        );
      }
      const mdx = unwrapMdxFence(transcript.result.mdx);
      const extracted = extractPageEntity({
        mdx,
        slug: sourceArtifact.page.slug,
        fallbackTitle: sourceArtifact.page.title
      });
      const alignment = alignTranslatedEntities(sourceArtifact.page, extracted);
      if ('mismatch' in alignment) {
        findings = [
          {
            source: 'verifier',
            check: 'translation-structure',
            severity: 'error',
            message: `translation to ${targetLocale} broke the document structure: ${alignment.mismatch}`
          }
        ];
        continue;
      }
      const artifact: PageArtifact = {
        page: alignment.page,
        mdx,
        mdxPath: contentRelativePath(targetLocale, sourceArtifact.page.slug),
        locale: targetLocale,
        version: ctx.version
      };
      const verifierResults = await runVerifiers({
        repoRoot: ctx.repoRoot,
        config: ctx.config,
        codemap: ctx.codemap,
        glossary: ctx.glossary,
        host: ctx.host,
        artifacts: [artifact],
        includeSiteScope: false
      });
      findings = errorFindings(verifierResults);
      lastArtifact = artifact;
      if (findings.length === 0) {
        break;
      }
    }

    if (lastArtifact === undefined) {
      // Structure never aligned: ship nothing for this locale, flag it (never silently wrong).
      lastArtifact = {
        ...sourceArtifact,
        mdxPath: contentRelativePath(targetLocale, sourceArtifact.page.slug),
        locale: targetLocale
      };
    }
    const passed = findings.length === 0;
    const shard: PageShard = {
      schemaVersion: 1,
      locale: targetLocale,
      version: ctx.version,
      sourceCommit: ctx.commit,
      generatedAt: new Date().toISOString(),
      page: lastArtifact.page,
      flags: passed
        ? []
        : [
            {
              id: mintId(idPrefixes.flag),
              kind: 'system',
              status: 'open',
              summary: `translation to ${targetLocale} failed verification on "${sourceArtifact.page.slug}"`,
              detail: findings.map((finding) => `[${finding.check}] ${finding.message}`).join('\n'),
              entity: { version: ctx.version, locale: targetLocale, pageId: sourceArtifact.page.id },
              runId: ctx.journal.runId,
              createdAt: new Date().toISOString()
            }
          ]
    };
    results.push({
      outcome: {
        locale: targetLocale,
        slug: sourceArtifact.page.slug,
        status: passed ? 'passed' : 'flagged',
        findings
      },
      artifact: lastArtifact,
      shard
    });
  }
  return results;
};
