import { buildCodemap } from '@docstube/codemap';
import type { DocstubeConfig } from '@docstube/contracts';
import { docstubeConfigSchema } from '@docstube/contracts';
import { createPluginHost } from '../plugins/plugin-host.ts';
import { registerBuiltinPlugins } from '../plugins/load-plugins.ts';
import { resolveCommit } from '../pipeline/generate.ts';
import type { TaskRunner } from '../pipeline/page-runner.ts';
import { buildExtractClaimsTask, claimsFromTranscript } from './extract-claims.ts';
import { buildCodemapIndex, matchClaim } from './match-claims.ts';
import { parseForeignDocs } from './parse-foreign-docs.ts';

// `docstube audit`: the measuring device behind the public metric (PRODUCT §1.3) and the GTM
// wedge (PRODUCT §2). Codemap of the audited repo × claims extracted from arbitrary existing docs
// → deterministic defect report. Approach: knowledge/design/audit.md.

export type AuditDefect = {
  file: string;
  claimText: string;
  identifier: string;
  reason: string;
};

export type AuditReport = {
  pages: number;
  claims: number;
  grounded: number;
  unverifiable: number;
  // Extracted "claims" whose anchor quote does not appear in the page — extractor hallucinations,
  // dropped before matching (a claim that is not in the docs can never be a published defect).
  unanchoredClaims: number;
  defects: AuditDefect[];
  // Over ALL claims: grounded + unverifiable + defective. Unverifiable claims dilute the rate but
  // are never defects — the metric must not overclaim.
  defectsPer100Claims: number;
  warnings: string[];
};

export type RunAuditOptions = {
  repoRoot: string;
  docsDir: string;
  runTask: TaskRunner;
  maxPages?: number | undefined;
};

// Audit runs on arbitrary repos with no docstube setup (the GTM play), so when no docstube.yml
// exists the CLI falls back to this minimal config: default transport (claude-cli), stub site
// title and persona — enough for createTaskRunnerFromConfig, irrelevant to the report.
export const auditFallbackConfig = (): DocstubeConfig =>
  docstubeConfigSchema.parse({
    schemaVersion: 1,
    docType: 'external-library',
    projectContext: 'Repository being audited by docstube audit.',
    personas: [{ id: 'reader', description: 'A developer reading the existing documentation.' }],
    site: { title: 'docstube audit' }
  });

export const runAudit = async (options: RunAuditOptions): Promise<AuditReport> => {
  const host = createPluginHost();
  await registerBuiltinPlugins(host);
  const commit = await resolveCommit(options.repoRoot);
  const codemap = await buildCodemap({
    repoRoot: options.repoRoot,
    commit,
    packs: host.languagePacks().map((entry) => entry.definition)
  });
  const index = buildCodemapIndex(codemap);

  const parsed = await parseForeignDocs({ docsDir: options.docsDir });
  const warnings = parsed.skipped.map((entry) => `skipped "${entry.file}": ${entry.reason}`);
  const pages = options.maxPages === undefined ? parsed.pages : parsed.pages.slice(0, options.maxPages);
  if (options.maxPages !== undefined && parsed.pages.length > options.maxPages) {
    warnings.push(`audited ${options.maxPages} of ${parsed.pages.length} pages (maxPages cap)`);
  }

  let claims = 0;
  let grounded = 0;
  let unverifiable = 0;
  let unanchoredClaims = 0;
  const defects: AuditDefect[] = [];
  for (const page of pages) {
    const transcript = await options.runTask(buildExtractClaimsTask(page));
    const extraction = claimsFromTranscript(page.file, transcript);
    if (extraction.warning !== undefined) {
      warnings.push(extraction.warning);
    }
    for (const claim of extraction.claims) {
      if (!page.markdown.includes(claim.anchor.quote)) {
        unanchoredClaims += 1;
        continue;
      }
      claims += 1;
      const match = matchClaim(claim, index);
      if (match.status === 'grounded') {
        grounded += 1;
      } else if (match.status === 'unverifiable') {
        unverifiable += 1;
      } else {
        for (const defect of match.defects) {
          defects.push({
            file: page.file,
            claimText: claim.text,
            identifier: defect.identifier,
            reason: defect.reason
          });
        }
      }
    }
  }

  if (unanchoredClaims > 0) {
    warnings.push(`${unanchoredClaims} extracted claim(s) had no anchor quote in their page and were dropped`);
  }
  const defectsPer100Claims = claims === 0 ? 0 : Math.round((defects.length / claims) * 100 * 100) / 100;
  return {
    pages: pages.length,
    claims,
    grounded,
    unverifiable,
    unanchoredClaims,
    defects,
    defectsPer100Claims,
    warnings
  };
};
