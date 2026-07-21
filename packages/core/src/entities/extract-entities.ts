import type { Heading, Root, RootContent } from 'mdast';
import type { MdxJsxAttribute, MdxJsxExpressionAttribute, MdxJsxFlowElement } from 'mdast-util-mdx-jsx';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMdx from 'remark-mdx';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { parse as parseYaml } from 'yaml';
import type { BlockEntity, PageEntity, SectionEntity } from '@docstube/contracts';
import { componentBlockType, contentHash, idPrefixes, mintId } from '@docstube/contracts';

// Deterministic extraction pass (ARCHITECTURE.md §3.4): MDX → entity tree. IDs live in the
// manifest sidecar, never inline in MDX — the writer agent produces clean MDX and the kernel owns
// identity. Freshly minted ids are remapped to stable ones by match-entities.ts.

const mdxProcessor = unified().use(remarkParse).use(remarkMdx).use(remarkGfm).use(remarkFrontmatter, ['yaml']);

export const parseMdx = (mdx: string): Root => mdxProcessor.parse(mdx) as Root;

// Frontmatter is MODEL OUTPUT, so it may be invalid YAML (live-hit: an unquoted description
// containing ": "). Extraction must never crash on it — fall back to a line-based scan so the
// page still gets a title, and let the mdx-compile verifier report the syntax error for retry.
const parseFrontmatterLeniently = (raw: string): Record<string, unknown> => {
  try {
    const parsed = parseYaml(raw) as Record<string, unknown> | null;
    return parsed ?? {};
  } catch {
    const lenient: Record<string, unknown> = {};
    for (const key of ['title', 'description']) {
      const match = new RegExp(`^${key}:\\s*(.+)\\s*$`, 'm').exec(raw);
      if (match?.[1] !== undefined) {
        lenient[key] = match[1].replace(/^['"]|['"]$/g, '');
      }
    }
    return lenient;
  }
};

const nodeText = (node: unknown): string => {
  if (node === null || typeof node !== 'object') {
    return '';
  }
  const record = node as { type?: string; value?: unknown; children?: unknown[] };
  if (record.type === 'text' || record.type === 'inlineCode') {
    return typeof record.value === 'string' ? record.value : '';
  }
  return (record.children ?? []).map(nodeText).join('');
};

export const slugifyAnchor = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'section';

const sliceSource = (mdx: string, node: RootContent): string => {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return start === undefined || end === undefined ? '' : mdx.slice(start, end);
};

const jsxAttributesToMetadata = (
  attributes: Array<MdxJsxAttribute | MdxJsxExpressionAttribute>
): Record<string, unknown> => {
  const metadata: Record<string, unknown> = {};
  for (const attribute of attributes) {
    if (attribute.type !== 'mdxJsxAttribute') {
      continue;
    }
    if (attribute.value === null || attribute.value === undefined) {
      metadata[attribute.name] = true;
    } else if (typeof attribute.value === 'string') {
      metadata[attribute.name] = attribute.value;
    } else {
      // Expression attribute: keep the raw expression text; registry validation decides.
      metadata[attribute.name] = { $expression: attribute.value.value };
    }
  }
  return metadata;
};

const blockTypeFor = (
  node: RootContent
): { blockType: string; language?: string; metadata?: Record<string, unknown> } => {
  switch (node.type) {
    case 'paragraph': {
      const children = node.children;
      if (children.length === 1 && children[0]?.type === 'image') {
        return { blockType: 'image' };
      }
      return { blockType: 'paragraph' };
    }
    case 'code':
      return { blockType: 'code-example', ...(node.lang ? { language: node.lang } : {}) };
    case 'list':
      return { blockType: 'list' };
    case 'table':
      return { blockType: 'table' };
    case 'blockquote':
      return { blockType: 'blockquote' };
    case 'thematicBreak':
      return { blockType: 'thematic-break' };
    case 'mdxJsxFlowElement': {
      const jsx = node as MdxJsxFlowElement;
      if (jsx.name === null || jsx.name === undefined) {
        return { blockType: 'raw' };
      }
      // The inline Claim marker is claim vocabulary, NOT a component: it must never change the
      // owning block's semantic type. A writer who formats the marker across lines produces a
      // flow element wrapping the same prose — the block stays a paragraph so block matching and
      // structural snapshots are formatting-insensitive. (submit_page rejects flow markers on the
      // generation path; this keeps audit extraction of foreign docs consistent too.)
      if (jsx.name === 'Claim') {
        return { blockType: 'paragraph' };
      }
      return { blockType: componentBlockType(jsx.name), metadata: jsxAttributesToMetadata(jsx.attributes) };
    }
    default:
      return { blockType: 'raw' };
  }
};

const buildBlock = (mdx: string, node: RootContent): BlockEntity => {
  const { blockType, language, metadata } = blockTypeFor(node);
  // Code blocks hash the code BODY (not the fenced source slice) — verifiers locate snippets in
  // MDX by hashing the fence contents, and the two must agree.
  const hashedContent = node.type === 'code' ? node.value : sliceSource(mdx, node);
  return {
    id: mintId(idPrefixes.block),
    kind: 'block',
    blockType,
    ...(metadata === undefined ? {} : { metadata }),
    contentHash: contentHash(hashedContent),
    ...(language === undefined ? {} : { language }),
    variants: [],
    claims: [],
    // Initial level; the verify stage upgrades to proven / caps to out-of-domain.
    guarantee: 'scored',
    provenance: { sources: [], seedContext: [], observedReads: [], verifications: [], reviews: [] }
  };
};

// Source ranges of body blocks in extraction order (preamble first, then each section's blocks) —
// the same order extractPageEntity emits, so callers can zip ranges with a page's flattened
// blocks to locate a text offset's owning block (claim anchoring).
export const blockSourceRanges = (mdx: string): Array<[number, number]> => {
  const tree = parseMdx(mdx);
  const ranges: Array<[number, number]> = [];
  for (const node of tree.children) {
    // Frontmatter, ESM plumbing, and headings never become blocks (headings delimit sections).
    if (node.type === 'yaml' || node.type === 'mdxjsEsm' || node.type === 'heading') {
      continue;
    }
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    ranges.push(start === undefined || end === undefined ? [0, 0] : [start, end]);
  }
  return ranges;
};

export type ExtractPageInput = {
  mdx: string;
  slug: string;
  fallbackTitle?: string | undefined;
};

export const extractPageEntity = ({ mdx, slug, fallbackTitle }: ExtractPageInput): PageEntity => {
  const tree = parseMdx(mdx);
  let title: string | undefined;
  let description: string | undefined;
  const preamble: BlockEntity[] = [];
  const sections: SectionEntity[] = [];
  const anchorCounts = new Map<string, number>();
  let sawTitleHeading = false;

  const uniqueAnchor = (base: string): string => {
    const count = anchorCounts.get(base) ?? 0;
    anchorCounts.set(base, count + 1);
    return count === 0 ? base : `${base}-${count + 1}`;
  };

  for (const node of tree.children) {
    if (node.type === 'yaml') {
      const frontmatter = parseFrontmatterLeniently(node.value);
      if (typeof frontmatter.title === 'string') {
        title = frontmatter.title;
      }
      if (typeof frontmatter.description === 'string') {
        description = frontmatter.description;
      }
      continue;
    }
    if (node.type === 'heading') {
      const heading = node as Heading;
      const headingText = nodeText(heading);
      // The first level-1 heading is the page title, not a section.
      if (heading.depth === 1 && !sawTitleHeading) {
        sawTitleHeading = true;
        title = title ?? headingText;
        continue;
      }
      sections.push({
        id: mintId(idPrefixes.section),
        kind: 'section',
        title: headingText,
        level: heading.depth,
        anchor: uniqueAnchor(slugifyAnchor(headingText)),
        blocks: [],
        guarantee: 'scored'
      });
      continue;
    }
    if (node.type === 'mdxjsEsm') {
      // import/export statements are page plumbing, not content entities.
      continue;
    }
    const block = buildBlock(mdx, node);
    const currentSection = sections[sections.length - 1];
    if (currentSection === undefined) {
      preamble.push(block);
    } else {
      currentSection.blocks.push(block);
    }
  }

  return {
    id: mintId(idPrefixes.page),
    kind: 'page',
    slug,
    title: title ?? fallbackTitle ?? slug,
    ...(description === undefined ? {} : { description }),
    preamble,
    sections,
    guarantee: 'scored',
    provenance: { sources: [], seedContext: [], observedReads: [], verifications: [], reviews: [] }
  };
};
