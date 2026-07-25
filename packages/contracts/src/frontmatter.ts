// ONE CANONICAL FRONTMATTER SPLIT (wave 2b close), shared by every stage that has to decide where
// a page's frontmatter ends and its prose begins: the writer submission scanner (agent-runtime),
// kernel entity extraction (core), the MDX verifier, and site emission (theme).
//
// It lives in contracts because a SECOND definition is not a duplicate, it is a cross-boundary
// CONSISTENCY BUG. Emission was made tolerant of the three forms Astro accepts while the kernel
// still used remark's strict rule, so a page whose `---` is preceded by a blank line was parsed
// two different ways: remark read `---\ntitle: X\n---` as a thematic break plus a setext heading,
// so the kernel minted a SYNTHETIC section titled `title: X` and anchored claims and section proof
// to it — and emission then stripped that exact text as frontmatter, leaving recorded proof
// pointing at an anchor that does not exist in the rendered page. Both sides must read the same
// bytes as frontmatter or the trust spine addresses prose the reader never sees.
//
// The tolerant rules, as the single definition:
//   - a UTF-8 BOM before the opening delimiter (what a Windows editor writes),
//   - blank or whitespace-only lines above it,
//   - CRLF line endings,
//   - an EMPTY block (`---\n---`), which is frontmatter PRESENT with no keys, not absent.
// A document that opens with anything else is returned untouched, so a `---` thematic break in the
// body can never be mistaken for a frontmatter delimiter.

export type FrontmatterSplit = {
  // The YAML text between the delimiters, without its trailing newline. Empty both for a document
  // with no frontmatter and for a present-but-empty block — `hadFrontmatter` distinguishes them.
  frontmatter: string;
  // Everything after the closing delimiter. For a document with no frontmatter this is the whole
  // document (BOM removed), never a partial slice.
  body: string;
  hadFrontmatter: boolean;
  // The document as a Markdown/MDX parser must see it: the BOM and any blank lines above the
  // opening delimiter removed, so `---` sits at offset 0 and remark recognizes the block. Node
  // offsets taken from parsing THIS string are the canonical offsets the kernel addresses prose by
  // (markers, block source ranges); nothing may mix them with offsets into the raw source, which is
  // why the canonical text travels with the split instead of being recomputed per call site.
  canonicalSource: string;
};

// U+FEFF, written as an escape so the source file itself never carries a stray BOM character.
const byteOrderMark = String.fromCharCode(0xfeff);
const leadingBlankLines = /^(?:[ \t]*\r?\n)*/u;
const openDelimiter = /^---[ \t]*\r?\n/u;
// Multiline: the closing delimiter is the first line in the remaining text that is exactly `---`.
const closeDelimiter = /^---[ \t]*(?:\r?\n|$)/mu;

export const splitFrontmatter = (source: string): FrontmatterSplit => {
  const text = source.startsWith(byteOrderMark) ? source.slice(byteOrderMark.length) : source;
  const absent: FrontmatterSplit = { frontmatter: '', body: text, hadFrontmatter: false, canonicalSource: text };
  const blank = leadingBlankLines.exec(text)?.[0] ?? '';
  const afterBlank = text.slice(blank.length);
  const open = openDelimiter.exec(afterBlank);
  if (open === null) {
    return absent;
  }
  const rest = afterBlank.slice(open[0].length);
  const close = closeDelimiter.exec(rest);
  if (close === null) {
    return absent;
  }
  return {
    frontmatter: rest.slice(0, close.index).replace(/\r?\n$/u, ''),
    body: rest.slice(close.index + close[0].length),
    hadFrontmatter: true,
    canonicalSource: afterBlank
  };
};

// The parse-side half of the same rule: what a remark/MDX processor must be handed so it reads the
// frontmatter block emission reads. Offsets from the resulting tree are canonical offsets.
export const canonicalMdxSource = (source: string): string => splitFrontmatter(source).canonicalSource;
