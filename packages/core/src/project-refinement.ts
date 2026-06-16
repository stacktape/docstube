import { findingSchema } from '@docstube/contracts';
import type { Finding, Manifest, ManifestPage, PageId, RelativePath, Timestamp } from '@docstube/contracts';
import { openDocstubeDatabase } from './db-migrations.ts';
import { readManifestFile, updateManifest, writeManifestFile } from './incremental-engine.ts';
import { createLocalBackend } from './local-backend.ts';
import { generateConfiguredProjectPages } from './project-generation.ts';
import type { GeneratedProjectPage, ProjectGenerationAdapterFactory } from './project-generation.ts';
import { initializeRunFromConfigFamily, transitionRunStatus } from './pipeline-run.ts';
import type { ScheduledPage } from './pipeline-run.ts';
import {
  collectProjectSourceFiles,
  defaultConfigPath,
  ensureDocstubeDir,
  projectDbPath,
  projectManifestPath,
  withOutputPaths
} from './project-workspace.ts';
import type { PageDetail } from './state-backend.ts';

export type ProjectRefinementOptions = {
  adapterFactory?: ProjectGenerationAdapterFactory;
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
  refinedPages: GeneratedProjectPage[];
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

const refinementMissedScheduleFinding = (candidate: RefinementCandidate): Finding =>
  findingSchema.parse({
    code: 'refinement-page-not-in-ia',
    severity: 'major',
    origin: 'editor',
    message: `Page was selected for refinement but is not present in the configured information architecture: ${candidate.id}`,
    pageId: candidate.id
  });

const refinementBrief = (page: ScheduledPage, candidate: RefinementCandidate): string => {
  const findingLines = candidate.findings
    .slice(0, 8)
    .map((finding) => `- ${finding.severity} ${finding.code}: ${finding.message}`);
  return [
    page.brief,
    `Refine this page because its quality score is ${candidate.score}.`,
    `Priority reasons: ${candidate.reasons.join(', ')}.`,
    findingLines.length > 0 ? ['Previous findings to address:', ...findingLines].join('\n') : undefined
  ]
    .filter((line): line is string => line !== undefined && line.length > 0)
    .join('\n');
};

const scheduledRefinementPages = (input: {
  candidates: readonly RefinementCandidate[];
  pages: readonly ScheduledPage[];
}): { missing: Finding[]; pages: ScheduledPage[] } => {
  const byId = new Map(input.pages.map((page) => [page.id, page]));
  const missing: Finding[] = [];
  const pages = input.candidates.flatMap((candidate): ScheduledPage[] => {
    const page = byId.get(candidate.id);
    if (!page) {
      missing.push(refinementMissedScheduleFinding(candidate));
      return [];
    }

    return [
      {
        ...page,
        brief: refinementBrief(page, candidate)
      }
    ];
  });

  return { missing, pages };
};

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
    const scheduled = scheduledRefinementPages({
      candidates: plannedPages,
      pages: withOutputPaths(initialized.config, initialized.scheduledPages)
    });
    const sourceFiles = await collectProjectSourceFiles({
      workspaceDir: input.workspaceDir,
      config: initialized.config
    });
    const generation =
      scheduled.pages.length > 0
        ? await generateConfiguredProjectPages({
            adapterFactory: input.adapterFactory,
            backend,
            config: initialized.config,
            generatedAt: now(),
            glossary: initialized.glossary,
            pages: scheduled.pages,
            runId: initialized.run.id,
            sourceFiles,
            workspaceDir: input.workspaceDir
          })
        : { capFrozen: false, generatedPages: [], manifestPages: [] };

    if (scheduled.missing.length > 0) {
      await Promise.all(
        scheduled.missing.map((finding) =>
          backend.upsertPage({
            id: finding.pageId ?? 'unknown',
            runId: initialized.run.id,
            title: finding.pageId ?? 'Unknown page',
            slug: finding.location?.path ?? 'unknown',
            status: 'flagged',
            approved: false,
            findings: [finding],
            updatedAt: now()
          })
        )
      );
    }

    const nextManifest = generation.manifestPages.length
      ? updateManifest({
          existing: manifest,
          generatedWith: { name: 'docstube', version: docstubeVersion },
          pages: generation.manifestPages
        })
      : manifest;
    if (generation.manifestPages.length > 0) {
      await writeManifestFile(manifestPath, nextManifest);
    }
    await transitionRunStatus({ backend, runId: initialized.run.id, status: 'completed', now });

    return {
      candidates,
      refinedPages: generation.generatedPages,
      manifest: nextManifest,
      manifestPath,
      plannedPages,
      runId: initialized.run.id
    };
  } finally {
    await backend.close();
  }
};
