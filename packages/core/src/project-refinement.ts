import { findingSchema } from '@docstube/contracts';
import type { Finding, Manifest, ManifestPage, PageId, RelativePath, Timestamp } from '@docstube/contracts';
import { openDocstubeDatabase } from './db-migrations.ts';
import { readManifestFile, updateManifest, writeManifestFile } from './incremental-engine.ts';
import type { ManifestPageUpdate } from './incremental-engine.ts';
import { createLocalBackend } from './local-backend.ts';
import { initializeRunFromConfigFamily, transitionRunStatus } from './pipeline-run.ts';
import { defaultConfigPath, ensureDocstubeDir, projectDbPath, projectManifestPath } from './project-workspace.ts';
import type { PageDetail } from './state-backend.ts';

export type ProjectRefinementOptions = {
  configPath?: string;
  dbPath?: string;
  failedOnly?: boolean;
  maxRounds?: number;
  now?: () => Timestamp;
  target?: string;
  workspaceDir: string;
};

export type PageQualitySummary = {
  blockerFindings: number;
  majorFindings: number;
  minorFindings: number;
  score: number;
};

export type RefinementCandidate = PageQualitySummary & {
  findings: Finding[];
  id: PageId;
  path?: RelativePath;
  reasons: string[];
  status: ManifestPage['status'];
  title?: string;
  updatedAt?: Timestamp;
};

export type ProjectRefinementResult = {
  candidates: RefinementCandidate[];
  manifest: Manifest;
  manifestPath: string;
  plannedPages: RefinementCandidate[];
  runId: string;
};

const defaultTimestamp: Timestamp = '2026-06-16T00:00:00.000Z';
const docstubeVersion = '0.0.2';

const severityCounts = (findings: readonly Finding[]): Omit<PageQualitySummary, 'score'> => ({
  blockerFindings: findings.filter((finding) => finding.severity === 'blocker').length,
  majorFindings: findings.filter((finding) => finding.severity === 'major').length,
  minorFindings: findings.filter((finding) => finding.severity === 'minor').length
});

export const derivePageQualitySummary = (input: {
  findings: readonly Finding[];
  status: ManifestPage['status'];
}): PageQualitySummary => {
  const counts = severityCounts(input.findings);
  const penalty =
    (input.status === 'flagged' ? 20 : 0) +
    counts.blockerFindings * 50 +
    counts.majorFindings * 20 +
    counts.minorFindings * 5;

  return {
    ...counts,
    score: Math.max(0, 100 - penalty)
  };
};

const candidateReasons = (input: PageQualitySummary & { findings: readonly Finding[]; status: string }): string[] => {
  const reasons: string[] = [];
  if (input.status === 'flagged') {
    reasons.push('flagged');
  }
  if (input.blockerFindings > 0) {
    reasons.push('blocker-findings');
  }
  if (input.majorFindings > 0) {
    reasons.push('major-findings');
  }
  if (input.findings.some((finding) => finding.origin === 'verifier')) {
    reasons.push('deterministic-gate-findings');
  }
  if (input.score < 100) {
    reasons.push('quality-below-perfect');
  }
  return reasons.length > 0 ? reasons : ['clean'];
};

export const rankRefinementCandidates = (input: {
  manifest: Manifest;
  pages: readonly PageDetail[];
}): RefinementCandidate[] => {
  const pagesById = new Map(input.pages.map((page) => [page.id, page]));
  const candidates = input.manifest.pages.map((manifestPage): RefinementCandidate => {
    const page = pagesById.get(manifestPage.id);
    const findings = page?.findings ?? [];
    const status = page?.status === 'flagged' || manifestPage.status === 'flagged' ? 'flagged' : 'passed';
    const quality = derivePageQualitySummary({ status, findings });

    return {
      ...quality,
      id: manifestPage.id,
      path: manifestPage.path,
      title: page?.title ?? manifestPage.title,
      status,
      findings,
      reasons: candidateReasons({ ...quality, findings, status }),
      updatedAt: page?.updatedAt
    };
  });

  return candidates.toSorted((left, right) => {
    if (left.score !== right.score) {
      return left.score - right.score;
    }
    if (left.blockerFindings !== right.blockerFindings) {
      return right.blockerFindings - left.blockerFindings;
    }
    if (left.majorFindings !== right.majorFindings) {
      return right.majorFindings - left.majorFindings;
    }
    if ((left.updatedAt ?? '') !== (right.updatedAt ?? '')) {
      return (left.updatedAt ?? '').localeCompare(right.updatedAt ?? '');
    }
    return left.id.localeCompare(right.id);
  });
};

const matchesTarget = (candidate: RefinementCandidate, target: string): boolean =>
  candidate.id === target || candidate.path === target;

const shouldConsiderFailedOnly = (candidate: RefinementCandidate): boolean =>
  candidate.status === 'flagged' ||
  candidate.blockerFindings > 0 ||
  candidate.majorFindings > 0 ||
  candidate.findings.some((finding) => finding.origin === 'verifier');

const refinementPlannedFinding = (candidate: RefinementCandidate): Finding =>
  findingSchema.parse({
    code: 'refinement-planned',
    severity: 'minor',
    origin: 'editor',
    message:
      'Page was selected for deterministic refinement planning; agent-backed rewriting is not available in this slice.',
    pageId: candidate.id,
    meta: {
      score: candidate.score,
      reasons: candidate.reasons
    }
  });

const mergePlannedFinding = (findings: readonly Finding[], planned: Finding): Finding[] => {
  const withoutOldPlanned = findings.filter((finding) => finding.code !== planned.code);
  return [...withoutOldPlanned, planned];
};

const manifestUpdateFromPage = (page: ManifestPage): ManifestPageUpdate => ({
  id: page.id,
  path: page.path,
  title: page.title,
  status: 'flagged',
  sections: page.sections,
  provenance: page.provenance
});

export const refineProjectDocumentation = async (input: ProjectRefinementOptions): Promise<ProjectRefinementResult> => {
  const dbPath = input.dbPath ?? projectDbPath(input.workspaceDir);
  const manifestPath = projectManifestPath(input.workspaceDir);
  const now = input.now ?? (() => defaultTimestamp);

  await ensureDocstubeDir(input.workspaceDir);
  const backend = createLocalBackend(openDocstubeDatabase(dbPath));
  try {
    const initialized = await initializeRunFromConfigFamily({
      backend,
      configPath: input.configPath ?? defaultConfigPath,
      workspaceDir: input.workspaceDir,
      now
    });
    await transitionRunStatus({ backend, runId: initialized.run.id, status: 'running', now });

    const manifest = await readManifestFile(manifestPath);
    const pageSummaries = await backend.listPages(initialized.run.id);
    const pages = await Promise.all(pageSummaries.map((page) => backend.getPage(page.id))).then((details) =>
      details.filter((detail): detail is PageDetail => detail !== null)
    );
    const candidates = rankRefinementCandidates({ manifest, pages });
    const scoped = candidates
      .filter((candidate) => (input.target ? matchesTarget(candidate, input.target) : true))
      .filter((candidate) => (input.failedOnly ? shouldConsiderFailedOnly(candidate) : candidate.score < 100));
    const plannedPages = scoped.slice(0, input.maxRounds ?? 1);
    const manifestById = new Map(manifest.pages.map((page) => [page.id, page]));
    const timestamp = now();
    const plannedUpdates = plannedPages.flatMap((candidate) => {
      const manifestPage = manifestById.get(candidate.id);
      if (!manifestPage) {
        return [];
      }

      const plannedFinding = refinementPlannedFinding(candidate);
      const findings = mergePlannedFinding(candidate.findings, plannedFinding);
      return [
        {
          findings,
          manifestPage,
          candidate
        }
      ];
    });
    await Promise.all(
      plannedUpdates.map(({ candidate, findings, manifestPage }) =>
        backend.upsertPage({
          id: candidate.id,
          runId: initialized.run.id,
          title: candidate.title ?? manifestPage.title ?? candidate.id,
          slug: manifestPage.path,
          status: 'flagged',
          approved: false,
          findings,
          updatedAt: timestamp
        })
      )
    );
    const updates = plannedUpdates.map(({ manifestPage }) => manifestUpdateFromPage(manifestPage));

    const nextManifest = updates.length
      ? updateManifest({
          existing: manifest,
          generatedWith: { name: 'docstube', version: docstubeVersion },
          pages: updates
        })
      : manifest;
    if (updates.length > 0) {
      await writeManifestFile(manifestPath, nextManifest);
    }
    await transitionRunStatus({ backend, runId: initialized.run.id, status: 'completed', now });

    return {
      candidates,
      manifest: nextManifest,
      manifestPath,
      plannedPages,
      runId: initialized.run.id
    };
  } finally {
    await backend.close();
  }
};
