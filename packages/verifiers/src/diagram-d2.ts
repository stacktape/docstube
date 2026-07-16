import { D2 } from '@terrastruct/d2';
import type { Codemap, Finding } from '@docstube/contracts';
import type { PageArtifact, VerifierDefinition } from '@docstube/plugin-sdk';
import { mapFencesByHash } from './code-typecheck-ts.ts';
import type { MdxCodeBlock } from './code-typecheck-ts.ts';
import { matchingCodeBlocks, missingFenceFinding, runVerifier } from './run-support.ts';

// Verified diagrams (PRODUCT §4.1, "very important"): D2 only. Compile proves the diagram is
// well-formed; GROUNDING proves it is true — every node must map to a codemap symbol. Founder
// call (2026-07): ungrounded nodes WARN by default (visible, never silent, block stays unproven —
// conceptual actors like User/Browser are legitimate), and a fence marked `strict` upgrades
// grounding failures to gating errors for diagrams that must be fully code-grounded.

const verifierId = 'diagram-d2';

// D2 keys that are attributes/directives, never nodes.
const reservedKeys = new Set([
  'shape',
  'style',
  'label',
  'icon',
  'near',
  'direction',
  'width',
  'height',
  'class',
  'classes',
  'vars',
  'grid-rows',
  'grid-columns',
  'grid-gap',
  'tooltip',
  'link',
  'constraint',
  'source-arrowhead',
  'target-arrowhead'
]);

export type D2Node = {
  // Dotted path as written ("api.server"); grounding checks the full path and the last segment.
  path: string;
  label?: string | undefined;
  line: number;
};

const stripQuotes = (value: string): string => value.replace(/^["']|["']$/gu, '').trim();

const cleanRef = (raw: string): string =>
  stripQuotes(raw.trim())
    .replace(/\s*\{$/u, '')
    .trim();

// Line-based structural parse — deliberately not a full D2 grammar: it extracts node references
// from connections (`a -> b`) and declarations (`name: Label`, `container: {`), tracking brace
// nesting so nested declarations become dotted paths. Attribute keys are skipped via reservedKeys.
export const extractD2Nodes = (source: string): D2Node[] => {
  const nodes = new Map<string, D2Node>();
  const stack: string[] = [];

  const addNode = (rawRef: string, line: number, label?: string) => {
    const ref = cleanRef(rawRef);
    if (ref === '' || ref === '_' || ref.startsWith('$')) {
      return;
    }
    const segments = ref.split('.').map((segment) => stripQuotes(segment.trim()));
    if (segments.some((segment) => reservedKeys.has(segment))) {
      return;
    }
    const path = [...stack, ...segments].join('.');
    const existing = nodes.get(path);
    if (existing === undefined || (existing.label === undefined && label !== undefined)) {
      nodes.set(path, { path, line, ...(label === undefined ? {} : { label: stripQuotes(label) }) });
    }
  };

  const lines = source.split(/\r?\n/u);
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.replace(/#.*$/u, '').trim();
    if (line === '' || line.startsWith('...')) {
      continue;
    }
    const lineNumber = index + 1;

    if (line === '}' || line === '} ;') {
      stack.pop();
      continue;
    }

    // Connections: split on arrows, endpoints may chain (a -> b -> c) and carry a trailing label.
    if (/(->|<->|<-|--)/u.test(line)) {
      const withoutLabel = line.split(/:(?![^[]*\])/u)[0] ?? line;
      const endpoints = withoutLabel.split(/->|<->|<-|--/u);
      for (const endpoint of endpoints) {
        addNode(endpoint, lineNumber);
      }
      continue;
    }

    // Declarations: `key: value` or `key: {` or bare `key` — key may open a container.
    const opensBlock = /\{\s*$/u.test(line);
    const colonIndex = line.indexOf(':');
    const key = colonIndex === -1 ? line : line.slice(0, colonIndex);
    const value =
      colonIndex === -1
        ? undefined
        : line
            .slice(colonIndex + 1)
            .replace(/\{\s*$/u, '')
            .trim();
    const keyRef = cleanRef(key);
    if (keyRef === '' || keyRef.split('.').some((segment) => reservedKeys.has(stripQuotes(segment.trim())))) {
      if (opensBlock) {
        // Attribute block (style: { … }) — push a sentinel so the matching `}` pops correctly.
        stack.push('');
      }
      continue;
    }
    addNode(keyRef, lineNumber, value === undefined || value === '' ? undefined : value);
    if (opensBlock) {
      stack.push(cleanRef(keyRef));
    }
  }

  // Sentinel-scoped paths (inside attribute blocks) were never added; drop empty segments.
  return [...nodes.values()].filter((node) => !node.path.split('.').includes(''));
};

// A node is grounded when its dotted path, last segment, or label names a codemap symbol
// (name, dotted containerPath+name, or containerPath tail). Case-insensitive: diagrams often
// title-case labels.
export const groundD2Node = (node: D2Node, codemap: Codemap): boolean => {
  const candidates = new Set<string>();
  const push = (value: string | undefined) => {
    if (value !== undefined && value !== '') {
      candidates.add(value.toLowerCase());
    }
  };
  push(node.path);
  push(node.path.split('.').at(-1));
  push(node.label);
  push(node.label?.split('.').at(-1));

  for (const symbol of codemap.symbols) {
    const name = symbol.name.toLowerCase();
    const dotted = [...symbol.containerPath, symbol.name].join('.').toLowerCase();
    for (const candidate of candidates) {
      if (candidate === name || candidate === dotted || dotted.endsWith(`.${candidate}`)) {
        return true;
      }
    }
  }
  return false;
};

const hasStrictMeta = (fence: MdxCodeBlock): boolean => /(^|\s)strict(\s|$)/u.test(fence.meta);

const groundingFinding = (
  artifact: PageArtifact,
  blockId: string,
  fence: MdxCodeBlock,
  node: D2Node,
  strict: boolean
): Finding => ({
  source: 'verifier',
  check: verifierId,
  severity: strict ? 'error' : 'warning',
  message: `diagram node "${node.path}"${node.label ? ` (“${node.label}”)` : ''} does not map to any codemap symbol — it stays unproven; ground it or mark the fence \`strict\` to gate on grounding`,
  entity: { version: artifact.version, locale: artifact.locale, pageId: artifact.page.id, entityId: blockId },
  file: artifact.mdxPath,
  span: [fence.line + node.line, fence.line + node.line]
});

export const diagramD2Verifier: VerifierDefinition = {
  id: verifierId,
  title: 'D2 diagrams compile and every node is grounded',
  description:
    'D2-only diagrams (PRODUCT: no Mermaid). Compile catches malformed diagrams; grounding maps every node to a codemap symbol — ungrounded nodes warn (block unproven) and `strict` fences gate on grounding.',
  scope: 'block',
  appliesTo: { blockTypes: ['code-example'], languages: ['d2'] },
  localeScope: 'source-only',
  proves: true,
  verify: async (ctx, pages) =>
    runVerifier(verifierId, async () => {
      const findings: Finding[] = [];
      const coveredEntityIds: string[] = [];
      let d2: D2 | undefined;

      for (const artifact of pages) {
        const fencesByHash = mapFencesByHash(artifact.mdx);
        for (const block of matchingCodeBlocks(artifact.page, ['d2'])) {
          const fence = fencesByHash.get(block.contentHash);
          if (!fence) {
            findings.push(missingFenceFinding(verifierId, artifact, block));
            continue;
          }
          d2 ??= new D2();
          try {
            await d2.compile(fence.code);
          } catch (error) {
            findings.push({
              source: 'verifier',
              check: verifierId,
              severity: 'error',
              message: `D2 compile failed: ${error instanceof Error ? error.message : String(error)}`,
              entity: {
                version: artifact.version,
                locale: artifact.locale,
                pageId: artifact.page.id,
                entityId: block.id
              },
              file: artifact.mdxPath,
              span: [fence.line, fence.line]
            });
            continue;
          }

          const strict = hasStrictMeta(fence);
          const ungrounded = extractD2Nodes(fence.code).filter((node) => !groundD2Node(node, ctx.codemap));
          for (const node of ungrounded) {
            findings.push(groundingFinding(artifact, block.id, fence, node, strict));
          }
          // Fully grounded diagrams are proven; anything ungrounded stays visible and unproven.
          if (ungrounded.length === 0) {
            coveredEntityIds.push(block.id, ...block.claims.map((claim) => claim.id));
          }
        }
      }
      return { findings, coveredEntityIds };
    })
};
