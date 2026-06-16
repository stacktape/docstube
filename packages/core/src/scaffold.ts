import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { manifestSchema } from '@docstube/contracts';
import { docstubeVersion } from './core.ts';

// `.docstube/` scaffold helper.
//
// Creates only the committed-friendly artifacts: `manifest.yml`, `criteria/`, and `instructions/`.
// Machine-local state (`db.sqlite*`, `cache/`, `runs/`) is created lazily by the pipeline and is
// gitignored; the scaffold never writes it, and never writes secrets or transcripts. The manifest
// is left untouched if it already exists unless `force` is set, so re-scaffolding is safe.

export type ScaffoldOptions = {
  // Version recorded in the manifest's `generatedWith`. Defaults to the docstube version.
  version?: string;
  // Overwrite an existing `manifest.yml`. Defaults to false (non-destructive).
  force?: boolean;
};

export type ScaffoldResult = {
  root: string;
  docstubeDir: string;
  created: string[];
  skipped: string[];
};

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const manifestYaml = (version: string): string => {
  const manifest = manifestSchema.parse({ generatedWith: { name: 'docstube', version } });
  const header =
    '# docstube provenance manifest. Committed and portable.\n' +
    '# Machine-local state (db.sqlite, cache/, runs/) is intentionally not stored here.\n';
  return `${header}${stringify(manifest)}`;
};

const ensureKeptDir = async (dir: string, created: string[]): Promise<void> => {
  await mkdir(dir, { recursive: true });
  const keep = join(dir, '.gitkeep');
  if (!(await exists(keep))) {
    await writeFile(keep, '', 'utf8');
    created.push(keep);
  }
};

export const scaffoldDocstubeDir = async (root: string, options: ScaffoldOptions = {}): Promise<ScaffoldResult> => {
  const version = options.version ?? docstubeVersion;
  const docstubeDir = join(root, '.docstube');
  const created: string[] = [];
  const skipped: string[] = [];

  await mkdir(docstubeDir, { recursive: true });

  const manifestPath = join(docstubeDir, 'manifest.yml');
  if (options.force || !(await exists(manifestPath))) {
    await writeFile(manifestPath, manifestYaml(version), 'utf8');
    created.push(manifestPath);
  } else {
    skipped.push(manifestPath);
  }

  await ensureKeptDir(join(docstubeDir, 'criteria'), created);
  await ensureKeptDir(join(docstubeDir, 'instructions'), created);

  return { root, docstubeDir, created, skipped };
};
