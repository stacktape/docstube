import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { dirname as posixDirname, join as posixJoin, normalize as posixNormalize } from 'node:path/posix';
import {
  findingSchema,
  glossarySchema,
  iaSchema,
  manifestPageSchema,
  manifestSchema,
  pageIdSchema,
  pageProvenanceSchema,
  provenanceCitationSchema,
  relativePathSchema,
  sha256Schema
} from '@docstube/contracts';
import type {
  Finding,
  Glossary,
  Ia,
  Manifest,
  ManifestPage,
  PackageVersion,
  PageId,
  PageProvenance,
  ProvenanceCitation,
  RelativePath,
  Sha256
} from '@docstube/contracts';
import { parse, stringify } from 'yaml';
import { schedulePagesFromIa } from './pipeline-run.ts';

export type SourceSnapshotInput = {
  content: string;
  path: RelativePath;
  symbols?: Record<string, string>;
};

export type SourceSnapshot = {
  normalizedHash: Sha256;
  path: RelativePath;
  symbols: Record<string, Sha256>;
};

export type ChangedSource = {
  changedSymbols: string[];
  currentHash?: Sha256;
  kind: 'added' | 'deleted' | 'modified';
  path: RelativePath;
  previousHash?: Sha256;
};

export type ChangedSymbolRef = {
  path: RelativePath;
  symbol?: string;
};

export type DirtyPageAction = 'flag' | 'regenerate' | 'skip';

export type DirtyPageDecision = {
  action: DirtyPageAction;
  changedRefs: ChangedSymbolRef[];
  pageId: string;
  reasons: string[];
  uncertain: boolean;
};

export type DirtyPagesResult = {
  decisions: DirtyPageDecision[];
  dirtyPageIds: string[];
  findings: Finding[];
  skippedPageIds: string[];
  symbolToPages: Record<string, string[]>;
};

export type ResolveDirtyPagesInput = {
  candidatePageIds?: readonly string[];
  changedFiles?: readonly RelativePath[];
  changedSources?: readonly ChangedSource[];
  changedSymbols?: readonly ChangedSymbolRef[];
  currentSeedHashes?: Readonly<Record<string, Sha256>>;
  manifest: Manifest | { pages?: readonly unknown[] };
};

export type TopologyPage = {
  content: string;
  glossaryTerms?: readonly string[];
  id: PageId;
  path: RelativePath;
};

export type TopologyConsistencyInput = {
  glossary: Glossary;
  ia: Ia;
  manifest: Manifest;
  pages: readonly TopologyPage[];
  regeneratedPageIds?: readonly PageId[];
};

export type CreatePageProvenanceInput = {
  citations?: readonly ProvenanceCitation[];
  reads?: readonly RelativePath[];
  seedContext: unknown;
};

export type ManifestPageUpdate = {
  id: PageId;
  path: RelativePath;
  provenance: PageProvenance;
  sections?: readonly string[];
  status: ManifestPage['status'];
  title?: string;
};

export type UpdateManifestInput = {
  existing?: Manifest;
  generatedWith: PackageVersion;
  pages: readonly ManifestPageUpdate[];
};

const sha256 = (value: string): Sha256 => sha256Schema.parse(createHash('sha256').update(value).digest('hex'));

const sortJsonValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortJsonValue(item)])
    );
  }

  return value;
};

const canonicalJson = (value: unknown): string => JSON.stringify(sortJsonValue(value));

const uniqueSorted = <T extends string>(values: readonly T[]): T[] => [...new Set(values)].toSorted();

export const normalizeSourceForHash = (content: string): string => {
  const normalized = content
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trimEnd();
  return `${normalized}\n`;
};

export const hashNormalizedSource = (content: string): Sha256 => sha256(normalizeSourceForHash(content));

export const hashSeedContext = (seedContext: unknown): Sha256 => sha256(canonicalJson(seedContext));

export const createSourceSnapshot = (input: SourceSnapshotInput): SourceSnapshot => {
  const symbols = Object.fromEntries(
    Object.entries(input.symbols ?? {}).map(([name, content]) => [name, hashNormalizedSource(content)])
  );

  return {
    path: relativePathSchema.parse(input.path),
    normalizedHash: hashNormalizedSource(input.content),
    symbols
  };
};

export const detectChangedSources = (input: {
  current: readonly SourceSnapshot[];
  previous: readonly SourceSnapshot[];
}): ChangedSource[] => {
  const previousByPath = new Map(input.previous.map((snapshot) => [snapshot.path, snapshot]));
  const currentByPath = new Map(input.current.map((snapshot) => [snapshot.path, snapshot]));
  const paths = uniqueSorted([...previousByPath.keys(), ...currentByPath.keys()]);
  const changes: ChangedSource[] = [];

  for (const path of paths) {
    const previous = previousByPath.get(path);
    const current = currentByPath.get(path);
    if (previous?.normalizedHash === current?.normalizedHash) {
      continue;
    }

    const symbolNames = uniqueSorted([...Object.keys(previous?.symbols ?? {}), ...Object.keys(current?.symbols ?? {})]);
    const changedSymbols = symbolNames.filter((symbol) => previous?.symbols[symbol] !== current?.symbols[symbol]);

    changes.push({
      path,
      previousHash: previous?.normalizedHash,
      currentHash: current?.normalizedHash,
      changedSymbols,
      kind: previous ? (current ? 'modified' : 'deleted') : 'added'
    });
  }

  return changes;
};

const changedRefsFromInput = (input: ResolveDirtyPagesInput): ChangedSymbolRef[] => {
  const refs: ChangedSymbolRef[] = [];

  for (const path of input.changedFiles ?? []) {
    refs.push({ path: relativePathSchema.parse(path) });
  }

  for (const ref of input.changedSymbols ?? []) {
    refs.push({ path: relativePathSchema.parse(ref.path), symbol: ref.symbol });
  }

  for (const change of input.changedSources ?? []) {
    if (change.changedSymbols.length === 0) {
      refs.push({ path: relativePathSchema.parse(change.path) });
      continue;
    }

    for (const symbol of change.changedSymbols) {
      refs.push({ path: relativePathSchema.parse(change.path), symbol });
    }
  }

  const byKey = new Map<string, ChangedSymbolRef>();
  for (const ref of refs) {
    byKey.set(`${ref.path}#${ref.symbol ?? '*'}`, ref);
  }
  return [...byKey.values()].toSorted((left, right) =>
    `${left.path}#${left.symbol ?? '*'}`.localeCompare(`${right.path}#${right.symbol ?? '*'}`)
  );
};

const refKey = (ref: ChangedSymbolRef): string => `${ref.path}${ref.symbol ? `#${ref.symbol}` : ''}`;

const pageTracksRef = (page: ManifestPage, ref: ChangedSymbolRef): boolean => {
  if (page.provenance.reads.includes(ref.path)) {
    return true;
  }

  return page.provenance.citations.some((citation) => {
    if (citation.path !== ref.path) {
      return false;
    }
    return !ref.symbol || !citation.symbol || citation.symbol === ref.symbol;
  });
};

export const mapChangedSymbolsToPages = (
  manifest: Manifest,
  changedRefs: readonly ChangedSymbolRef[]
): Record<string, string[]> => {
  const parsed = manifestSchema.parse(manifest);
  const mapping = new Map<string, string[]>();

  for (const ref of changedRefs) {
    const pages = parsed.pages.filter((page) => pageTracksRef(page, ref)).map((page) => page.id);
    mapping.set(refKey(ref), uniqueSorted(pages));
  }

  return Object.fromEntries([...mapping.entries()].toSorted(([left], [right]) => left.localeCompare(right)));
};

const pageIdFromRawPage = (rawPage: unknown, index: number): string => {
  if (rawPage && typeof rawPage === 'object' && 'id' in rawPage && typeof rawPage.id === 'string') {
    return rawPage.id;
  }
  return `manifest-page-${index + 1}`;
};

const findingForUnusableProvenance = (pageId: string): Finding => {
  const parsedPageId = pageIdSchema.safeParse(pageId);
  return findingSchema.parse({
    code: 'provenance-corrupt',
    severity: 'major',
    origin: 'verifier',
    message: `Page ${pageId} has missing or invalid provenance, so it cannot be safely skipped.`,
    pageId: parsedPageId.success ? parsedPageId.data : undefined,
    meta: { pageId }
  });
};

export const resolveDirtyPages = (input: ResolveDirtyPagesInput): DirtyPagesResult => {
  const rawPages = Array.isArray(input.manifest.pages) ? input.manifest.pages : [];
  const changedRefs = changedRefsFromInput(input);
  const candidatePageIds = input.candidatePageIds ? new Set(input.candidatePageIds) : undefined;
  const decisions: DirtyPageDecision[] = [];
  const findings: Finding[] = [];
  const validPages: ManifestPage[] = [];

  for (const [index, rawPage] of rawPages.entries()) {
    const pageId = pageIdFromRawPage(rawPage, index);
    const parsedPage = manifestPageSchema.safeParse(rawPage);
    const isCandidate = candidatePageIds ? candidatePageIds.has(pageId) : true;

    if (!parsedPage.success) {
      if (isCandidate) {
        const finding = findingForUnusableProvenance(pageId);
        findings.push(finding);
        decisions.push({
          pageId,
          action: 'flag',
          changedRefs,
          reasons: ['provenance-corrupt'],
          uncertain: true
        });
      } else {
        decisions.push({ pageId, action: 'skip', changedRefs: [], reasons: [], uncertain: false });
      }
      continue;
    }

    const page = parsedPage.data;
    validPages.push(page);
    const directRefs = changedRefs.filter((ref) => pageTracksRef(page, ref));
    const currentSeedHash = input.currentSeedHashes?.[page.id];
    const seedChanged = currentSeedHash !== undefined && currentSeedHash !== page.provenance.seedHash;
    const reasons: string[] = [];

    if (directRefs.length > 0) {
      reasons.push('changed-provenance-input');
    }
    if (seedChanged) {
      reasons.push('seed-context-changed');
    }

    if (reasons.length === 0) {
      decisions.push({ pageId: page.id, action: 'skip', changedRefs: [], reasons, uncertain: false });
      continue;
    }

    decisions.push({
      pageId: page.id,
      action: 'regenerate',
      changedRefs: directRefs,
      reasons,
      uncertain: directRefs.length === 0 && seedChanged && isCandidate
    });
  }

  const symbolToPages = mapChangedSymbolsToPages(
    manifestSchema.parse({
      version: 1,
      generatedWith: { name: 'docstube', version: '0.0.0' },
      pages: validPages
    }),
    changedRefs
  );
  const dirtyPageIds = decisions.filter((decision) => decision.action !== 'skip').map((decision) => decision.pageId);
  const skippedPageIds = decisions.filter((decision) => decision.action === 'skip').map((decision) => decision.pageId);

  return { decisions, dirtyPageIds, skippedPageIds, findings, symbolToPages };
};

export const extractMarkdownDocLinks = (content: string): string[] =>
  [...content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((match) => match[1] ?? '');

const resolveDocLink = (fromPath: RelativePath, target: string): RelativePath | null => {
  if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(target)) {
    return null;
  }

  const bareTarget = target.split(/[?#]/, 1)[0] ?? '';
  if (!bareTarget.endsWith('.mdx')) {
    return null;
  }

  const normalized = bareTarget.startsWith('/')
    ? bareTarget.slice(1)
    : posixNormalize(posixJoin(posixDirname(fromPath), bareTarget));
  const parsed = relativePathSchema.safeParse(normalized);
  return parsed.success ? parsed.data : null;
};

export const extractGlossaryReferences = (content: string): string[] =>
  [...content.matchAll(/\{\{glossary:([a-z0-9]+(?:-[a-z0-9]+)*)\}\}/g)].map((match) => match[1] ?? '');

const topologyFinding = (input: {
  code: string;
  message: string;
  pageId?: PageId;
  severity?: Finding['severity'];
  meta?: Record<string, string | string[]>;
}): Finding =>
  findingSchema.parse({
    code: input.code,
    severity: input.severity ?? 'major',
    origin: 'verifier',
    message: input.message,
    pageId: input.pageId,
    meta: input.meta
  });

export const runTopologyConsistencyPass = (input: TopologyConsistencyInput): Finding[] => {
  const ia = iaSchema.parse(input.ia);
  const manifest = manifestSchema.parse(input.manifest);
  const glossary = glossarySchema.parse(input.glossary);
  const findings: Finding[] = [];
  const scheduledPages = schedulePagesFromIa(ia);
  const manifestById = new Map(manifest.pages.map((page) => [page.id, page]));
  const pathToPageIds = new Map<string, string[]>();
  const regeneratedPageIds = input.regeneratedPageIds ? new Set(input.regeneratedPageIds) : undefined;

  for (const page of manifest.pages) {
    pathToPageIds.set(page.path, [...(pathToPageIds.get(page.path) ?? []), page.id]);
  }

  for (const page of scheduledPages) {
    const manifestPage = manifestById.get(page.id);
    if (!manifestPage) {
      findings.push(
        topologyFinding({
          code: 'nav-reference-missing',
          message: `IA page ${page.id} points to ${page.slug}, but the manifest has no matching page.`,
          pageId: page.id,
          meta: { path: page.slug }
        })
      );
      continue;
    }

    if (manifestPage.path !== page.slug) {
      findings.push(
        topologyFinding({
          code: 'nav-path-mismatch',
          message: `IA page ${page.id} points to ${page.slug}, but the manifest records ${manifestPage.path}.`,
          pageId: page.id,
          meta: { expected: page.slug, actual: manifestPage.path }
        })
      );
    }
  }

  for (const [path, pageIds] of pathToPageIds) {
    if (pageIds.length > 1) {
      findings.push(
        topologyFinding({
          code: 'duplicate-page-slug',
          message: `Multiple pages resolve to ${path}.`,
          meta: { path, pageIds }
        })
      );
    }
  }

  const knownPaths = new Set(pathToPageIds.keys());
  const pathToSinglePageId = new Map(
    [...pathToPageIds.entries()]
      .filter(([, pageIds]) => pageIds.length === 1)
      .map(([path, pageIds]) => [path, pageIds[0]!])
  );
  const glossaryKeys = new Set<string>();
  for (const term of glossary.terms) {
    glossaryKeys.add(term.id.toLowerCase());
    glossaryKeys.add(term.term.toLowerCase());
    for (const alias of term.aliases ?? []) {
      glossaryKeys.add(alias.toLowerCase());
    }
  }

  for (const page of input.pages) {
    for (const link of extractMarkdownDocLinks(page.content)) {
      const targetPath = resolveDocLink(page.path, link);
      if (!targetPath) {
        continue;
      }

      if (!knownPaths.has(targetPath)) {
        findings.push(
          topologyFinding({
            code: 'cross-page-link-stale',
            message: `Page ${page.id} links to ${targetPath}, which is not present in the manifest.`,
            pageId: page.id,
            meta: { targetPath }
          })
        );
        continue;
      }

      const targetPageId = pathToSinglePageId.get(targetPath);
      if (targetPageId && regeneratedPageIds?.has(targetPageId) && !regeneratedPageIds.has(page.id)) {
        findings.push(
          topologyFinding({
            code: 'cross-page-link-review',
            message: `Page ${page.id} links to regenerated page ${targetPageId} and should be revisited.`,
            pageId: page.id,
            severity: 'minor',
            meta: { targetPageId, targetPath }
          })
        );
      }
    }

    if (regeneratedPageIds && !regeneratedPageIds.has(page.id)) {
      continue;
    }

    const glossaryRefs = uniqueSorted([...(page.glossaryTerms ?? []), ...extractGlossaryReferences(page.content)]);
    for (const glossaryRef of glossaryRefs) {
      if (!glossaryKeys.has(glossaryRef.toLowerCase())) {
        findings.push(
          topologyFinding({
            code: 'glossary-term-missing',
            message: `Page ${page.id} uses glossary term ${glossaryRef}, but it is not defined.`,
            pageId: page.id,
            meta: { glossaryRef }
          })
        );
      }
    }
  }

  return findings;
};

export const createPageProvenance = (input: CreatePageProvenanceInput): PageProvenance => {
  const reads = uniqueSorted((input.reads ?? []).map((path) => relativePathSchema.parse(path)));
  const citations = [
    ...new Map(
      (input.citations ?? [])
        .map((citation) => provenanceCitationSchema.parse(citation))
        .toSorted((left, right) =>
          `${left.path}#${left.symbol ?? ''}`.localeCompare(`${right.path}#${right.symbol ?? ''}`)
        )
        .map((citation) => [`${citation.path}#${citation.symbol ?? ''}`, citation])
    ).values()
  ];

  return pageProvenanceSchema.parse({
    seedHash: hashSeedContext(input.seedContext),
    reads,
    citations
  });
};

export const updateManifest = (input: UpdateManifestInput): Manifest => {
  const pagesById = new Map((input.existing?.pages ?? []).map((page) => [page.id, page]));

  for (const page of input.pages) {
    pagesById.set(
      page.id,
      manifestPageSchema.parse({
        id: page.id,
        path: page.path,
        title: page.title,
        status: page.status,
        sections: page.sections ?? [],
        provenance: page.provenance
      })
    );
  }

  return manifestSchema.parse({
    version: 1,
    generatedWith: input.generatedWith,
    pages: [...pagesById.values()].toSorted((left, right) => left.path.localeCompare(right.path))
  });
};

export const readManifestFile = async (manifestPath: string): Promise<Manifest> =>
  manifestSchema.parse(parse(await readFile(manifestPath, 'utf8')));

export const writeManifestFile = async (manifestPath: string, manifest: Manifest): Promise<void> => {
  const parsed = manifestSchema.parse(manifest);
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(
    manifestPath,
    `# docstube provenance manifest. Committed and portable.\n${stringify(parsed)}`,
    'utf8'
  );
};
