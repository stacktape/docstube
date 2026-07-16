import type { BlockEntity, PageEntity, SectionEntity } from '@docstube/contracts';
import { listPageEntityIds } from '@docstube/contracts';

// The matching pass (ARCHITECTURE.md §3.4): align a freshly extracted entity tree against the
// previous shard so stable ids survive regeneration. Matched entities keep their ids; unmatched
// keep the freshly minted ones; previous ids that matched nothing are tombstoned (feedback
// attached to them is surfaced, never silently dropped). Ids are never reused.

export type MatchedPage = {
  page: PageEntity;
  tombstonedIds: string[];
};

const matchSections = (fresh: SectionEntity[], previous: SectionEntity[]): Map<string, string> => {
  // fresh section id → previous section id
  const mapping = new Map<string, string>();
  const usedPrevious = new Set<string>();

  // Pass 1: exact title + level.
  for (const section of fresh) {
    const candidate = previous.find(
      (prev) => !usedPrevious.has(prev.id) && prev.title === section.title && prev.level === section.level
    );
    if (candidate) {
      mapping.set(section.id, candidate.id);
      usedPrevious.add(candidate.id);
    }
  }
  // Pass 2: same anchor (title edited, slug kept).
  for (const section of fresh) {
    if (mapping.has(section.id)) {
      continue;
    }
    const candidate = previous.find((prev) => !usedPrevious.has(prev.id) && prev.anchor === section.anchor);
    if (candidate) {
      mapping.set(section.id, candidate.id);
      usedPrevious.add(candidate.id);
    }
  }
  // Pass 3: positional — same level, same ordinal among still-unmatched sections.
  const unmatchedFresh = fresh.filter((section) => !mapping.has(section.id));
  const unmatchedPrevious = previous.filter((section) => !usedPrevious.has(section.id));
  for (const [index, section] of unmatchedFresh.entries()) {
    const candidate = unmatchedPrevious[index];
    if (candidate && candidate.level === section.level) {
      mapping.set(section.id, candidate.id);
      usedPrevious.add(candidate.id);
    }
  }
  return mapping;
};

type LocatedBlock = { block: BlockEntity; sectionKey: string; ordinal: number };

const locateBlocks = (page: PageEntity, sectionKeyOf: (sectionId: string) => string): LocatedBlock[] => {
  const located: LocatedBlock[] = [];
  for (const [ordinal, block] of page.preamble.entries()) {
    located.push({ block, sectionKey: '<preamble>', ordinal });
  }
  for (const section of page.sections) {
    for (const [ordinal, block] of section.blocks.entries()) {
      located.push({ block, sectionKey: sectionKeyOf(section.id), ordinal });
    }
  }
  return located;
};

const matchBlocks = (fresh: LocatedBlock[], previous: LocatedBlock[]): Map<string, string> => {
  const mapping = new Map<string, string>();
  const usedPrevious = new Set<string>();

  // Pass 1: unique (blockType, contentHash) match anywhere on the page — moved content keeps id.
  for (const { block } of fresh) {
    const candidates = previous.filter(
      (prev) =>
        !usedPrevious.has(prev.block.id) &&
        prev.block.blockType === block.blockType &&
        prev.block.contentHash === block.contentHash
    );
    if (candidates.length === 1 && candidates[0]) {
      mapping.set(block.id, candidates[0].block.id);
      usedPrevious.add(candidates[0].block.id);
    }
  }
  // Pass 2: same section, same blockType, same ordinal among unmatched — edited content keeps id.
  const freshBySection = new Map<string, LocatedBlock[]>();
  for (const entry of fresh) {
    if (mapping.has(entry.block.id)) {
      continue;
    }
    const list = freshBySection.get(entry.sectionKey) ?? [];
    list.push(entry);
    freshBySection.set(entry.sectionKey, list);
  }
  for (const [sectionKey, entries] of freshBySection) {
    const previousInSection = previous.filter(
      (prev) => prev.sectionKey === sectionKey && !usedPrevious.has(prev.block.id)
    );
    for (const [index, entry] of entries.entries()) {
      const candidate = previousInSection[index];
      if (candidate && candidate.block.blockType === entry.block.blockType) {
        mapping.set(entry.block.id, candidate.block.id);
        usedPrevious.add(candidate.block.id);
      }
    }
  }
  return mapping;
};

export const matchEntityIds = (fresh: PageEntity, previous: PageEntity): MatchedPage => {
  const sectionMapping = matchSections(fresh.sections, previous.sections);

  // Blocks in matched sections compare within that section identity; others by preamble/self key.
  const freshBlocks = locateBlocks(fresh, (sectionId) => sectionMapping.get(sectionId) ?? sectionId);
  const previousBlocks = locateBlocks(previous, (sectionId) => sectionId);
  const blockMapping = matchBlocks(freshBlocks, previousBlocks);

  const previousBlocksById = new Map(previousBlocks.map((entry) => [entry.block.id, entry.block]));

  const remapBlock = (block: BlockEntity): BlockEntity => {
    const previousId = blockMapping.get(block.id);
    if (previousId === undefined) {
      return block;
    }
    const previousBlock = previousBlocksById.get(previousId);
    // Claims are agent-produced; carry forward claims whose anchor quote still exists in the
    // matched block (same content ⇒ same claims), otherwise drop — they will be re-extracted.
    const claims =
      previousBlock && previousBlock.contentHash === block.contentHash ? previousBlock.claims : block.claims;
    return { ...block, id: previousId, claims };
  };

  const page: PageEntity = {
    ...fresh,
    id: previous.id,
    preamble: fresh.preamble.map(remapBlock),
    sections: fresh.sections.map((section) => ({
      ...section,
      id: sectionMapping.get(section.id) ?? section.id,
      blocks: section.blocks.map(remapBlock)
    }))
  };

  const carriedIds = new Set(listPageEntityIds(page));
  const tombstonedIds = listPageEntityIds(previous).filter((id) => !carriedIds.has(id));
  return { page, tombstonedIds };
};
