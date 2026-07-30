import type {
  ContentHash,
  IaGroupNodeV2,
  IaNodeV2,
  IaPageNodeV2,
  PageShard,
  StructuralOutlineEntry,
  StructuralScope,
  StructuralSnapshot,
  StructuralSnapshotPage
} from '@docstube/contracts';
import { contentHashSchema, hashValue, structuralSnapshotSchema } from '@docstube/contracts';

// THE STRUCTURE PASS INPUT (quality-ci-reader-v2 decision 18). Built over the STAGED canonical
// site — the pages this run is about to publish — never over the committed tree, because the whole
// point is to judge the shape the reader is about to get.
//
// Everything the detectors and the group assessor are allowed to see lives here: nav cohorts with
// their ia.yml consistency posture, per-page brief / primary persona / structure profile / outline
// / block composition / claim subjects / plan, which scopes changed, which were skipped, and the
// keys of the prior findings that must be reconciled. Detectors take the SNAPSHOT, not the repo:
// that is what makes them testable without a filesystem and cacheable on a fingerprint.

// Cohort comparison is over normalized facets, not raw heading text: "Pricing", "pricing" and
// "Pricing & limits" must not read as three different sections, while "Pricing" and "Quotas" must
// stay distinct. Punctuation collapses, case folds, and an ampersand is treated as a word break.
export const normalizeFacet = (title: string): string =>
  title
    .toLowerCase()
    .normalize('NFKD')
    .replaceAll(/[\u0300-\u036f]/gu, '')
    .replaceAll(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');

// Blocks that carry no reader-visible body. A section holding only these is structurally empty
// however many entities it contains.
const inertBlockTypes = new Set(['thematic-break']);

export const sectionHasBody = (entry: Pick<StructuralOutlineEntry, 'blockTypes'>): boolean =>
  entry.blockTypes.some((blockType) => !inertBlockTypes.has(blockType));

const outlineOf = (shard: PageShard): StructuralOutlineEntry[] =>
  shard.page.sections.map((section) => ({
    title: section.title,
    level: section.level,
    sectionId: section.id,
    anchor: section.anchor,
    // Deduplicated but ORDER-PRESERVING: the assessor reads this as "what kind of material is in
    // this section", and repeated paragraph entries would only inflate the cache key.
    blockTypes: [...new Set(section.blocks.map((block) => block.blockType))]
  }));

// The cache ingredient for "did this page's structure move?" — titles, levels and block
// composition only. Prose edits inside a section deliberately do NOT change it, so a typo fix in
// one sibling never re-bills a whole group assessment (decision 7).
export const outlineHashOf = (outline: readonly StructuralOutlineEntry[]): ContentHash =>
  contentHashSchema.parse(
    hashValue(
      outline.map((entry) => ({ facet: normalizeFacet(entry.title), level: entry.level, blockTypes: entry.blockTypes }))
    )
  );

const blockSummaryOf = (shard: PageShard): Array<{ blockType: string; count: number }> => {
  const counts = new Map<string, number>();
  for (const block of [...shard.page.preamble, ...shard.page.sections.flatMap((section) => section.blocks)]) {
    counts.set(block.blockType, (counts.get(block.blockType) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([blockType, count]) => ({ blockType, count }))
    .toSorted((left, right) => left.blockType.localeCompare(right.blockType));
};

// The code subjects the page's ledger claims are about — the assessor's grounding for "is this
// page even the kind of thing that HAS pricing?", per decision 20.
const claimSubjectsOf = (shard: PageShard) =>
  [
    ...new Set(
      (shard.ledger?.claims ?? []).flatMap((claim) =>
        claim.subscriptions.flatMap((subscription) =>
          // Whole-file subscriptions name a path, not a symbol; only symbol-keyed subscriptions
          // identify what the page is ABOUT, which is what the assessor needs.
          subscription.kind === 'file-content' ? [] : [subscription.symbolHash]
        )
      )
    )
  ].toSorted();

export type IaGroupMembership = {
  // Nearest ancestor GROUP node, when the page has one. Pages at the tree root belong to no group
  // and are therefore never part of any sibling cohort — a deliberate 0.1.0 conservatism.
  groupId?: string;
  node: IaPageNodeV2;
};

// Flattens the v2 tree into pages tagged with their nearest ancestor group. A page nested UNDER
// another page (a child page node) inherits that page's group, not the parent page.
export const iaPageMembership = (tree: readonly IaNodeV2[]): IaGroupMembership[] => {
  const pages: IaGroupMembership[] = [];
  const visit = (node: IaNodeV2, groupId: string | undefined): void => {
    if (node.kind === 'group') {
      for (const child of node.children) {
        visit(child, node.groupId);
      }
      return;
    }
    pages.push({ ...(groupId === undefined ? {} : { groupId }), node });
    for (const child of node.children ?? []) {
      visit(child, groupId);
    }
  };
  for (const node of tree) {
    visit(node, undefined);
  }
  return pages;
};

export const iaGroups = (tree: readonly IaNodeV2[]): IaGroupNodeV2[] => {
  const groups: IaGroupNodeV2[] = [];
  const visit = (node: IaNodeV2): void => {
    if (node.kind === 'group') {
      groups.push(node);
      for (const child of node.children) {
        visit(child);
      }
      return;
    }
    for (const child of node.children ?? []) {
      visit(child);
    }
  };
  for (const node of tree) {
    visit(node);
  }
  return groups;
};

export type BuildStructuralSnapshotInput = {
  tree: readonly IaNodeV2[];
  // Staged source-locale shards by page SLUG — the IA addresses pages by slug until ids are minted.
  shardsBySlug: ReadonlyMap<string, PageShard>;
  // Page ids whose canonical content this run changed (or that are new). Detectors re-evaluate
  // exactly these pages plus the groups they belong to or left.
  changedPageIds?: readonly string[] | undefined;
  // Groups the pass could not evaluate (budget exhausted) — recorded, never silently dropped.
  pendingScopes?: readonly StructuralScope[] | undefined;
  priorFindingKeys?: readonly string[] | undefined;
  generatedAt?: string | undefined;
};

export const buildStructuralSnapshot = (input: BuildStructuralSnapshotInput): StructuralSnapshot => {
  const membership = iaPageMembership(input.tree);
  const groupsById = new Map(iaGroups(input.tree).map((group) => [group.groupId, group]));
  const pages: StructuralSnapshotPage[] = [];
  const groupPageIds = new Map<string, string[]>();

  for (const { groupId, node } of membership) {
    const shard = input.shardsBySlug.get(node.slug);
    if (shard === undefined) {
      // A planned page that produced no staged shard (frozen mid-plan, or a failed page) is not
      // part of this pass: judging a cohort against a page that does not exist would invent state.
      continue;
    }
    const outline = outlineOf(shard);
    pages.push({
      pageId: shard.page.id,
      ...(groupId === undefined ? {} : { groupId }),
      brief: node.brief,
      primaryPersona: node.primaryPersona,
      ...(node.structureProfile === undefined ? {} : { structureProfile: node.structureProfile }),
      structuralExceptions: node.structuralExceptions ?? [],
      outlineHash: outlineHashOf(outline),
      outline,
      blockSummary: blockSummaryOf(shard),
      claimSubjects: claimSubjectsOf(shard)
    });
    if (groupId !== undefined) {
      groupPageIds.set(groupId, [...(groupPageIds.get(groupId) ?? []), shard.page.id]);
    }
  }

  const changed = new Set(input.changedPageIds ?? []);
  const changedScopes: StructuralScope[] = pages
    .filter((page) => changed.has(page.pageId))
    .map((page) => ({ kind: 'entity' as const, pageId: page.pageId }));
  for (const [groupId, pageIds] of groupPageIds) {
    if (pageIds.some((pageId) => changed.has(pageId))) {
      changedScopes.push({ kind: 'nav-group', groupId, pageIds });
    }
  }

  return structuralSnapshotSchema.parse({
    schemaVersion: 1,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    groups: [...groupPageIds.entries()].map(([groupId, pageIds]) => {
      const group = groupsById.get(groupId);
      return {
        groupId,
        ...(group?.title === undefined ? {} : { title: group.title }),
        pageIds,
        consistencyMode: group?.consistency?.mode ?? 'inferred',
        consistencyRules: group?.consistency?.rules ?? []
      };
    }),
    pages,
    changedScopes,
    pendingScopes: input.pendingScopes ?? [],
    priorFindingKeys: input.priorFindingKeys ?? []
  });
};
