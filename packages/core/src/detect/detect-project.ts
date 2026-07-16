import { readdir } from 'node:fs/promises';
import type { DocType } from '@docstube/contracts';
import type { PackageManager } from './manifest-signals.ts';
import {
  detectDocType,
  detectFrameworks,
  detectLanguages,
  detectMonorepo,
  detectPackageManager,
  humanizePackageName,
  readPackageManifest
} from './manifest-signals.ts';
import { clampContext, readReadmeSignals } from './readme-signals.ts';
import { scanForSpecs } from './spec-sniff.ts';

// Deterministic detection engine (PRODUCT §3.9.2, decision log: "Wizard pre-fill is deterministic,
// never agent-based"). Everything here is pure fs reads — NO subprocesses, NO agent calls, ever.
// It must finish well under 1s on a big repo, so directory walking is bounded (root + 2 levels,
// node_modules/.git/dist skipped) and content sniffing reads at most the first 4KB per file.
// Shared module: serves the wizard, `doctor`, `audit`, and language-pack detection.
//
// The contract for optional fields: set only when the signal is unambiguous. Ambiguous fields stay
// undefined so the wizard shows them BLANK rather than pre-filled with a guess.

export type ProjectDetection = {
  docType?: DocType | undefined;
  siteTitle?: string | undefined;
  // Extracted verbatim from package.json description or the README — never generated.
  projectContext?: string | undefined;
  languages: string[];
  openapiSpecs: string[];
  asyncapiSpecs: string[];
  frameworks: string[];
  packageManager?: PackageManager | undefined;
  monorepo: boolean;
};

const readRootFileNames = async (repoRoot: string): Promise<ReadonlySet<string>> => {
  try {
    const entries = await readdir(repoRoot, { withFileTypes: true });
    return new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
  } catch {
    return new Set();
  }
};

export const detectProject = async (repoRoot: string): Promise<ProjectDetection> => {
  const [manifest, readme, specs, rootFileNames] = await Promise.all([
    readPackageManifest(repoRoot),
    readReadmeSignals(repoRoot),
    scanForSpecs(repoRoot),
    readRootFileNames(repoRoot)
  ]);

  const frameworks = detectFrameworks(manifest);
  const siteTitle =
    (typeof manifest?.name === 'string' ? humanizePackageName(manifest.name) : undefined) ?? readme.title;
  const contextSource =
    typeof manifest?.description === 'string' && manifest.description.trim().length > 0
      ? manifest.description
      : readme.firstParagraph;
  const projectContext = contextSource === undefined ? undefined : clampContext(contextSource);

  return {
    docType: detectDocType(manifest, frameworks),
    siteTitle,
    projectContext,
    languages: detectLanguages(manifest, rootFileNames),
    openapiSpecs: specs.openapiSpecs,
    asyncapiSpecs: specs.asyncapiSpecs,
    frameworks,
    packageManager: detectPackageManager(manifest, rootFileNames),
    monorepo: detectMonorepo(manifest, rootFileNames)
  };
};
