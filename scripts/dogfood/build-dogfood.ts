import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { env, execPath } from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type {
  ProjectGenerationAdapterFactory,
  ProjectGenerationOptions,
  ProjectGenerationResult
} from '@docstube/core';

export type DogfoodBuildInput = {
  buildSite?: boolean;
  core?: DogfoodCore;
  outputDir?: string;
  workspaceDir?: string;
};

export type DogfoodBuildResult = {
  files: readonly string[];
  generatedPages: readonly { id: string; path: string; status: string }[];
  outputDir: string;
  siteDir: string;
  siteDistDir?: string;
};

type PackageJson = {
  packageManager?: string;
  version?: string;
  workspaces?: unknown;
};

type DogfoodCore = {
  createDeterministicProjectGenerationAdapters: ProjectGenerationAdapterFactory;
  generateProjectDocumentation: (input: ProjectGenerationOptions) => Promise<ProjectGenerationResult>;
};

const execFileAsync = promisify(execFile);
const defaultOutputDir = 'dist-dogfood';
const dogfoodBuildCacheRoot = fileURLToPath(new URL('../../packages/theme/node_modules/.cache/', import.meta.url));
const astroCli = fileURLToPath(new URL('../../packages/theme/node_modules/astro/bin/astro.mjs', import.meta.url));

const planSummary = (plan: string): string => {
  const lines = plan
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const firstHeading = lines.find((line) => line.startsWith('# ')) ?? '# docstube';
  const productLine = lines.find((line) => line.includes('open-source MIT CLI')) ?? lines[0] ?? '';
  return [firstHeading.replace(/^#\s*/, ''), productLine].join('\n');
};

const collectFiles = async (rootDir: string, currentDir = rootDir): Promise<string[]> => {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const children = await Promise.all(
    entries.map(async (entry): Promise<string[]> => {
      const entryPath = join(currentDir, entry.name);
      if (entry.name === 'node_modules' || entry.name === '.astro') {
        return [];
      }
      if (entry.isDirectory()) {
        return collectFiles(rootDir, entryPath);
      }
      if (!entry.isFile()) {
        return [];
      }
      return [entryPath];
    })
  );

  return children.flat().toSorted((left, right) => left.localeCompare(right));
};

const loadBuiltCore = async (): Promise<DogfoodCore> => {
  const coreModulePath = new URL('../../packages/core/dist/core.mjs', import.meta.url).href;
  const core = (await import(coreModulePath)) as Partial<DogfoodCore>;
  if (
    typeof core.generateProjectDocumentation !== 'function' ||
    typeof core.createDeterministicProjectGenerationAdapters !== 'function'
  ) {
    throw new Error('Built @docstube/core is unavailable. Run `pnpm --filter @docstube/core build` first.');
  }
  return core as DogfoodCore;
};

const writeDogfoodProject = async (input: {
  packageRaw: string;
  plan: string;
  summary: string;
  tasks: string;
  workspaceDir: string;
}): Promise<void> => {
  const srcDir = join(input.workspaceDir, 'src');
  await mkdir(srcDir, { recursive: true });
  await Promise.all([
    writeFile(join(srcDir, 'PLAN.md'), input.plan, 'utf8'),
    writeFile(join(srcDir, 'tasks.md'), input.tasks, 'utf8'),
    writeFile(join(srcDir, 'package.json'), input.packageRaw, 'utf8'),
    writeFile(join(srcDir, 'summary.md'), input.summary, 'utf8'),
    writeFile(
      join(input.workspaceDir, 'docstube.yml'),
      [
        'version: 1',
        'site:',
        '  name: docstube dogfood',
        '  description: Deterministic docs generated from the docstube repository plan.',
        '  url: https://docstube.dev',
        'docsType: application',
        'output:',
        '  dir: docs',
        '  layout: single-tree',
        'personas:',
        '  - id: maintainer',
        '    title: Maintainer',
        '    goals:',
        '      - review release readiness',
        'agents:',
        '  writer:',
        '    adapter: codex',
        '  reviewer:',
        '    adapter: claude',
        'sources:',
        '  - kind: path',
        '    path: src',
        'ia: ia.yml',
        'glossary: glossary.yaml',
        ''
      ].join('\n'),
      'utf8'
    ),
    writeFile(
      join(input.workspaceDir, 'ia.yml'),
      [
        'version: 1',
        'nav:',
        '  - id: overview',
        '    title: Overview',
        '    brief: Explain what docstube is using the repository plan and package facts.',
        '  - id: tasks',
        '    title: Implementation',
        '    path: tasks.mdx',
        '    brief: Summarize implementation status from PLAN.md and tasks.md.',
        ''
      ].join('\n'),
      'utf8'
    ),
    writeFile(
      join(input.workspaceDir, 'glossary.yaml'),
      [
        'version: 1',
        'terms:',
        '  - id: source-grounding',
        '    term: Source grounding',
        '    definition: Documentation claims tied to concrete source files, symbols, or committed project facts.',
        '  - id: deterministic-verifier',
        '    term: Deterministic verifier',
        '    definition: A repeatable check that returns structured findings without calling live AI services.',
        ''
      ].join('\n'),
      'utf8'
    )
  ]);
};

const buildGeneratedSite = async (siteDir: string): Promise<string> => {
  await execFileAsync(execPath, [astroCli, 'build'], {
    cwd: siteDir,
    env: { ...env, CI: '1', NO_COLOR: '1' },
    maxBuffer: 10 * 1024 * 1024
  });
  await execFileAsync(execPath, [join(siteDir, 'scripts', 'postbuild.mjs')], {
    cwd: siteDir,
    env: { ...env, CI: '1', NO_COLOR: '1' },
    maxBuffer: 10 * 1024 * 1024
  });
  return join(siteDir, 'dist');
};

export const buildDogfoodDocs = async (input: DogfoodBuildInput = {}): Promise<DogfoodBuildResult> => {
  const workspaceDir = resolve(input.workspaceDir ?? '.');
  const outputDir = resolve(workspaceDir, input.outputDir ?? defaultOutputDir);
  if (outputDir === workspaceDir) {
    throw new Error('Dogfood outputDir must not be the repository workspace directory.');
  }

  const [plan, tasks, packageRaw] = await Promise.all([
    readFile(join(workspaceDir, 'PLAN.md'), 'utf8'),
    readFile(join(workspaceDir, 'tasks.md'), 'utf8'),
    readFile(join(workspaceDir, 'package.json'), 'utf8')
  ]);
  const packageJson = JSON.parse(packageRaw) as PackageJson;
  const taskCount = tasks.split(/\r?\n/g).filter((line) => /^## Task \d+/.test(line)).length;
  const summary = planSummary(plan);
  const core = input.core ?? (await loadBuiltCore());

  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  await mkdir(dogfoodBuildCacheRoot, { recursive: true });
  const tempRoot = await mkdtemp(join(dogfoodBuildCacheRoot, 'dogfood-'));
  try {
    const dogfoodWorkspaceDir = join(tempRoot, 'workspace');
    await writeDogfoodProject({
      packageRaw,
      plan,
      summary,
      tasks,
      workspaceDir: dogfoodWorkspaceDir
    });
    const generation = await core.generateProjectDocumentation({
      workspaceDir: dogfoodWorkspaceDir,
      adapterFactory: core.createDeterministicProjectGenerationAdapters
    });
    const generatedSiteDir = join(dogfoodWorkspaceDir, 'docs');
    const generatedSiteDistDir = input.buildSite === false ? undefined : await buildGeneratedSite(generatedSiteDir);
    const outputWorkspaceDir = join(outputDir, 'workspace');
    await cp(dogfoodWorkspaceDir, outputWorkspaceDir, { recursive: true });

    const siteDir = join(outputWorkspaceDir, 'docs');
    const siteDistDir = generatedSiteDistDir ? join(siteDir, 'dist') : undefined;
    const manifest = {
      generatedBy: 'docstube dogfood',
      generatedWith: packageJson.version ?? '0.0.0',
      generatedPages: generation.generatedPages.map((page) => ({
        id: page.id,
        path: page.path,
        status: page.status
      })),
      liveAgents: false,
      reviewRequired: true,
      runId: generation.runId,
      siteBuilt: siteDistDir !== undefined,
      sourceFilesCount: generation.sourceFilesCount,
      taskCount
    };
    const readme = [
      '# docstube dogfood docs',
      '',
      'This artifact is generated by the real docstube generation pipeline with deterministic replay adapters.',
      '',
      `- Version: ${packageJson.version ?? 'unknown'}`,
      `- Planned tasks: ${taskCount}`,
      `- Generated pages: ${generation.generatedPages.length}`,
      `- Site build: ${siteDistDir ? 'passed' : 'skipped'}`,
      '- Live agents: not used in this build',
      ''
    ].join('\n');

    const files = [join(outputDir, 'README.md'), join(outputDir, 'manifest.json')];
    await Promise.all([
      writeFile(files[0]!, readme, 'utf8'),
      writeFile(files[1]!, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    ]);
    const generatedFiles = await collectFiles(outputDir);
    return {
      files: generatedFiles.map((file) => relative(outputDir, file).replaceAll('\\', '/')),
      generatedPages: generation.generatedPages.map((page) => ({
        id: page.id,
        path: page.path,
        status: page.status
      })),
      outputDir,
      siteDir,
      siteDistDir
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
};

const runDirectly = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;

if (runDirectly) {
  const result = await buildDogfoodDocs();
  console.info(`Built dogfood docs at ${result.outputDir}`);
}
