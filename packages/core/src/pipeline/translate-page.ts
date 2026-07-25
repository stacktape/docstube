import type { PageArtifact } from '@docstube/plugin-sdk';
import { scanClaimMarkers } from '@docstube/agent-runtime';
import type { AgentTaskSpec, Finding, PageEntity, PageShard } from '@docstube/contracts';
import { agentTaskSpecSchema, contentHash, contentHashSchema, idPrefixes, mintId } from '@docstube/contracts';
import { blockSourceRanges, extractPageEntity, parseMdx } from '../entities/extract-entities.ts';
import { CoreError } from '../errors.ts';
import type { PageRunContext } from './page-runner.ts';
import { contentRelativePath, unwrapMdxFence } from './page-runner.ts';
import { errorFindings, runVerifiers } from './verify-page.ts';

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

// Block types with no translatable content: the translator must copy them byte-identically. An
// altered code block is a broken command shipping under a locale path, never a "less proven" one.
const UNTRANSLATABLE_BLOCK_TYPES = new Set(['code-example', 'thematic-break']);

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
    // Untranslatable blocks (code) must be byte-identical. A mismatch there is a hard alignment
    // error — retried, then flagged — never shipped as an altered command.
    if (
      UNTRANSLATABLE_BLOCK_TYPES.has(sourceBlock.blockType) &&
      translatedBlock.contentHash !== sourceBlock.contentHash
    ) {
      return `${where}[${index}]: ${sourceBlock.blockType} content was altered — untranslatable blocks must be byte-identical`;
    }
    // Identity carries; trust does not live on blocks anymore (the source shard's claim ledger is
    // the trust surface, and rendition-level fidelity is its own assessment axis).
    aligned.push({
      ...translatedBlock,
      id: sourceBlock.id,
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
    sections.push({ ...translatedSection, id: sourceSection.id, blocks });
  }
  return {
    page: {
      ...translated,
      id: source.id,
      slug: source.slug,
      preamble,
      sections,
      provenance: source.provenance
    }
  };
};

// Depth of every heading in document order (h1 title included) — the structural skeleton a
// rendition must reproduce exactly for canonical sections and locale sections to correspond
// positionally (the locale-anchor projection at emission maps them by index).
export const headingInventory = (mdx: string): number[] =>
  parseMdx(mdx).children.flatMap((node) => (node.type === 'heading' ? [node.depth] : []));

const renderHeadingDepths = (depths: readonly number[]): string =>
  depths.length === 0 ? '(none)' : depths.map((depth) => `h${depth}`).join(' ');

// WHERE a marker sits, not just that it exists: the index of the content block that owns it, in
// the same extraction order extractPageEntity emits (headings/frontmatter/ESM are not blocks, so
// the index is stable across renditions once the heading inventory matches). -1 means the marker
// sits outside any content block.
export type MarkerPlacement = { blockIndex: number; markerId: string };

export const markerPlacements = (mdx: string): MarkerPlacement[] => {
  const ranges = blockSourceRanges(mdx);
  return scanClaimMarkers(mdx).markers.map((marker) => ({
    blockIndex: ranges.findIndex(([start, end]) => marker.offset >= start && marker.offset < end),
    markerId: marker.markerId
  }));
};

const renderPlacements = (placements: readonly MarkerPlacement[]): string =>
  placements.length === 0
    ? '(none)'
    : placements.map((placement) => `"${placement.markerId}"@block${placement.blockIndex}`).join(', ');

// Page hygiene for translated MDX (wave 2b close): the writer's submission passes the marker
// scanner in-session, but a translation is a fresh artifact the scanner never saw — a translator
// could inject script/style (raw, or expression-wrapped) or malform the Claim markers. The same
// page-level checks run here before persistence; a failure fails the TRANSLATION (nonblocking —
// the source page is unaffected), never ships.
export const translationHygieneErrors = (
  mdx: string,
  sourcePlacements: readonly MarkerPlacement[],
  sourceHeadingDepths: readonly number[]
): string[] => {
  // NO TRANSLATION CAN THROW THE RUN (wave 2b close): every artifact scanned here is raw MODEL
  // output. A malformed rendition can make any parser in this function throw, and a translation
  // failure is NONBLOCKING by design (i18n-lifecycle-v2 decision 5) — so an exception becomes a
  // hygiene failure for THIS page-locale, leaving the source page and every other locale intact.
  try {
    return hygieneErrors(mdx, sourcePlacements, sourceHeadingDepths);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return [
      `[malformed-mdx] the translated document could not be parsed or scanned: ${detail} — a rendition must be ` +
        'valid MDX with the same structure as the source page'
    ];
  }
};

const hygieneErrors = (
  mdx: string,
  sourcePlacements: readonly MarkerPlacement[],
  sourceHeadingDepths: readonly number[]
): string[] => {
  const sourceMarkerIds = sourcePlacements.map((placement) => placement.markerId);
  const scan = scanClaimMarkers(mdx);
  const errors = scan.errors.map((error) => `[${error.code}] ${error.message}`);
  const markerCounts = new Map<string, number>();
  for (const marker of scan.markers) {
    markerCounts.set(marker.markerId, (markerCounts.get(marker.markerId) ?? 0) + 1);
  }
  let hasDuplicates = false;
  for (const [markerId, count] of markerCounts) {
    if (count > 1) {
      hasDuplicates = true;
      errors.push(`[marker-duplicate-id] marker "${markerId}" appears ${count} times — every marker id is unique`);
    }
  }
  // MARKER ISOMORPHISM (wave 2b close; i18n-lifecycle-v2 decision 4): renditions share the
  // canonical claim inventory — the source page's marker ids, exactly, no renames, no additions,
  // no removals. The locale route inherits the CANONICAL shard's per-claim marks by marker id at
  // emission, so a drifted inventory would attach trust marks to prose that asserts something
  // else (or to nothing). Set equality plus the duplicate check above gives exact inventory
  // equality; the SEQUENCE check below additionally rejects relocations.
  const sourceIds = new Set(sourceMarkerIds);
  const translatedIds = new Set(markerCounts.keys());
  const removed = [...sourceIds].filter((markerId) => !translatedIds.has(markerId));
  const added = [...translatedIds].filter((markerId) => !sourceIds.has(markerId));
  if (removed.length > 0 || added.length > 0) {
    const removedNote =
      removed.length > 0 ? `missing source marker(s) ${removed.map((id) => `"${id}"`).join(', ')}` : '';
    const addedNote = added.length > 0 ? `unknown marker(s) ${added.map((id) => `"${id}"`).join(', ')}` : '';
    errors.push(
      `[marker-isomorphism] the translated Claim marker inventory does not match the source page's markers ` +
        `(${[removedNote, addedNote].filter((note) => note !== '').join('; ')}) — a rendition must carry exactly ` +
        'the canonical marker ids, translated in place, never renamed, added, or removed'
    );
  } else if (!hasDuplicates) {
    // BLOCK-SCOPED ORDERED EQUALITY (wave 2b close final): set equality is not enough — swapping
    // or relocating two ids between translated assertions passes the set check while attaching
    // each canonical mark to the WRONG prose. Global sequence alone is not enough either: a
    // marker can move into ANOTHER same-typed block (paragraph 2 → paragraph 3) and keep the
    // document-order sequence intact while now annotating different prose. The rendition must
    // therefore reproduce the source's (owning block index, marker id) pairs EXACTLY — same ids,
    // same order, each in the same structural position.
    const translatedPlacements = markerPlacements(mdx);
    const translatedSequence = translatedPlacements.map((placement) => placement.markerId);
    const sameOrder =
      translatedSequence.length === sourceMarkerIds.length &&
      translatedSequence.every((markerId, index) => markerId === sourceMarkerIds[index]);
    if (sameOrder) {
      const sameBlocks = translatedPlacements.every(
        (placement, index) => placement.blockIndex === sourcePlacements[index]?.blockIndex
      );
      if (!sameBlocks) {
        errors.push(
          `[marker-block] the translated Claim markers keep the source order but sit in different content blocks ` +
            `(translated: ${renderPlacements(translatedPlacements)}; source: ${renderPlacements(sourcePlacements)}) — ` +
            'a marker moved into another block annotates prose the canonical claim never described; each marker ' +
            'must stay inside the translation of its own block'
        );
      }
    } else {
      errors.push(
        `[marker-order] the translated Claim markers appear in a different order than the source page's ` +
          `(translated: ${translatedSequence.map((id) => `"${id}"`).join(', ')}; source: ` +
          `${sourceMarkerIds.map((id) => `"${id}"`).join(', ')}) — a swapped or relocated marker attaches the ` +
          'canonical trust mark to the wrong prose; each marker must stay on the translation of its own sentence'
      );
    }
  }
  // HEADING INVENTORY (wave 2b close, impl-21): the rendition must reproduce the exact heading
  // skeleton — same count, same depths, same order — so section structure provably matches and
  // canonical sections map onto locale sections (and their localized anchors) by position.
  const translatedHeadings = headingInventory(mdx);
  const sameHeadings =
    translatedHeadings.length === sourceHeadingDepths.length &&
    translatedHeadings.every((depth, index) => depth === sourceHeadingDepths[index]);
  if (!sameHeadings) {
    errors.push(
      `[heading-inventory] the translated heading structure (${renderHeadingDepths(translatedHeadings)}) does not ` +
        `match the source page's (${renderHeadingDepths(sourceHeadingDepths)}) — a rendition keeps every heading ` +
        'at its depth and position (translating only the text), so sections correspond one-to-one across locales'
    );
  }
  return errors;
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
  // The canonical marker inventory every rendition must reproduce exactly — same ids, same
  // document order, same owning block (block-scoped ordered equality) — plus the heading skeleton.
  const sourcePlacements = markerPlacements(sourceArtifact.mdx);
  const sourceHeadingDepths = headingInventory(sourceArtifact.mdx);
  // The canonical revision this translation is made from: the exact source artifact bytes, hashed
  // the same way persistence mints the canonical shard's mdxContentHash. Recorded on the locale
  // shard at translation success; the emission revision gate compares it against the CURRENT
  // canonical shard and serves the source fallback on any drift.
  const sourceRevision = contentHashSchema.parse(contentHash(sourceArtifact.mdx));

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
      // NO TRANSLATION CAN THROW THE RUN (i18n-lifecycle-v2 decision 5; impl-23 finding 4): a
      // transport rejection (provider outage, auth failure, budget refusal, subprocess crash) and
      // a transcript that carries no MDX are the SAME nonblocking class as the hygiene/extraction
      // failures below — this page-locale fails, the source page and every other locale are
      // untouched, and the locale route falls back to the source content. Escaping here would
      // abort a whole generate run over one unreachable translator.
      let mdx: string;
      try {
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
            `the translator returned no MDX (stop: ${transcript.stopReason ?? 'unknown'})`
          );
        }
        mdx = unwrapMdxFence(transcript.result.mdx);
      } catch (error) {
        findings = [
          {
            source: 'verifier',
            check: 'translation-transport',
            severity: 'error',
            message:
              `translation to ${targetLocale} could not be produced: ` +
              `${error instanceof Error ? error.message : String(error)} — the locale route serves the ` +
              'source-locale content until the translation succeeds'
          }
        ];
        continue;
      }
      const hygiene = translationHygieneErrors(mdx, sourcePlacements, sourceHeadingDepths);
      if (hygiene.length > 0) {
        findings = hygiene.map((message) => ({
          source: 'verifier' as const,
          check: 'translation-hygiene',
          severity: 'error' as const,
          message: `translation to ${targetLocale} failed page hygiene: ${message}`
        }));
        continue;
      }
      // Extraction parses model output too — same nonblocking rule as hygiene above: a rendition
      // that hygiene somehow let through but extraction chokes on fails ITS page-locale, never
      // the run.
      let extracted: PageEntity;
      try {
        extracted = extractPageEntity({
          mdx,
          slug: sourceArtifact.page.slug,
          fallbackTitle: sourceArtifact.page.title
        });
      } catch (error) {
        findings = [
          {
            source: 'verifier',
            check: 'translation-hygiene',
            severity: 'error',
            message:
              `translation to ${targetLocale} failed page hygiene: [malformed-mdx] the translated document could ` +
              `not be extracted: ${error instanceof Error ? error.message : String(error)}`
          }
        ];
        continue;
      }
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
      schemaVersion: 2,
      locale: targetLocale,
      version: ctx.version,
      sourceCommit: ctx.commit,
      generatedAt: new Date().toISOString(),
      page: lastArtifact.page,
      // MDX↔shard binding for the translated artifact bytes (same rule as source shards) — minted
      // ONLY when the translation passed, because only then does the caller persist the locale
      // MDX. A failed translation writes no locale file, so its shard must stay HASHLESS: any
      // later emission of a fallback or stale file renders loud-UNVERIFIED instead of binding to
      // bytes that were never written. The locale→canonical revision binding
      // (sourceContentRevision) is minted under the same condition: it vouches that THIS
      // translation renders the canonical artifact at that exact revision, which is only true for
      // a shipped translation.
      ...(passed
        ? {
            mdxContentHash: contentHashSchema.parse(contentHash(lastArtifact.mdx)),
            sourceContentRevision: sourceRevision
          }
        : {}),
      // TRANSLATION ASSURANCE (i18n-lifecycle-v2 decision 3, the second proof dimension): a
      // shipped rendition inherits the CANONICAL shard's checked counts — claim state is
      // language-independent — but nothing here has judged whether the translation preserved
      // meaning. The bilingual fidelity review of decision 2 is implemented in the i18n wave; in
      // 0.1.0 every shipped translation records 'not-reviewed' so the reader sees the honest
      // second dimension instead of a rendition that reads as fully checked. A failed
      // translation's route serves the source fallback, which is exactly 'fallback'.
      translationAssurance: passed ? ('not-reviewed' as const) : ('fallback' as const),
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
