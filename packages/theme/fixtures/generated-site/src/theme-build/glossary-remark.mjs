const skippedParentTypes = new Set([
  'code',
  'definition',
  'inlineCode',
  'link',
  'linkReference',
  'mdxJsxFlowElement',
  'mdxJsxTextElement'
]);

const escapeRegExp = (value) => value.replaceAll(/[\\^$.*+?()[\]{}|]/gu, '\\$&');

const glossaryMatches = (glossary) =>
  glossary.terms
    .flatMap((term) => [term.term, ...(term.aliases ?? [])].map((label) => ({ ...term, label })))
    .toSorted((left, right) => right.label.length - left.label.length || left.label.localeCompare(right.label));

const linkedGlossaryNodes = (value, matchesByLabel, pattern) => {
  const nodes = [];
  let cursor = 0;

  for (const match of value.matchAll(pattern)) {
    const matchText = match[0];
    const index = match.index;
    const glossaryMatch = matchesByLabel.get(matchText.toLowerCase());
    if (!glossaryMatch) {
      continue;
    }

    if (index > cursor) {
      nodes.push({ type: 'text', value: value.slice(cursor, index) });
    }

    nodes.push({
      type: 'link',
      url: `/glossary/#${glossaryMatch.id}`,
      title: glossaryMatch.definition,
      children: [{ type: 'text', value: matchText }]
    });
    cursor = index + matchText.length;
  }

  if (cursor < value.length) {
    nodes.push({ type: 'text', value: value.slice(cursor) });
  }

  return nodes.length > 0 ? nodes : [{ type: 'text', value }];
};

const linkGlossaryChildren = (node, matchesByLabel, pattern) => {
  if (!node.children || skippedParentTypes.has(node.type ?? '')) {
    return;
  }

  const nextChildren = [];
  for (const child of node.children) {
    if (child.type === 'text' && child.value) {
      nextChildren.push(...linkedGlossaryNodes(child.value, matchesByLabel, pattern));
    } else {
      linkGlossaryChildren(child, matchesByLabel, pattern);
      nextChildren.push(child);
    }
  }

  node.children = nextChildren;
};

export const createGlossaryRemarkPlugin = (glossary) => {
  const matches = glossaryMatches(glossary);
  const pattern =
    matches.length > 0
      ? new RegExp(
          `(?<![\\p{L}\\p{N}_])(${matches.map((match) => escapeRegExp(match.label)).join('|')})(?![\\p{L}\\p{N}_])`,
          'giu'
        )
      : undefined;
  const matchesByLabel = new Map(matches.map((match) => [match.label.toLowerCase(), match]));

  return () => (tree) => {
    if (pattern) {
      linkGlossaryChildren(tree, matchesByLabel, pattern);
    }
  };
};
