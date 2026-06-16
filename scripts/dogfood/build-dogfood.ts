import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type DogfoodBuildInput = {
  outputDir?: string;
  workspaceDir?: string;
};

export type DogfoodBuildResult = {
  files: readonly string[];
  outputDir: string;
};

type PackageJson = {
  packageManager?: string;
  version?: string;
  workspaces?: unknown;
};

const defaultOutputDir = 'dist-dogfood';

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const planSummary = (plan: string): string => {
  const lines = plan
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const firstHeading = lines.find((line) => line.startsWith('# ')) ?? '# docstube';
  const productLine = lines.find((line) => line.includes('open-source MIT CLI')) ?? lines[0] ?? '';
  return [firstHeading.replace(/^#\s*/, ''), productLine].join('\n');
};

const packageRows = (packageJson: PackageJson): string =>
  (
    [
      ['version', packageJson.version ?? 'unknown'],
      ['package manager', packageJson.packageManager ?? 'unknown'],
      ['workspace style', 'apps/* and packages/*']
    ] satisfies Array<readonly [string, string]>
  )
    .map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`)
    .join('\n');

export const buildDogfoodDocs = async (input: DogfoodBuildInput = {}): Promise<DogfoodBuildResult> => {
  const workspaceDir = resolve(input.workspaceDir ?? '.');
  const outputDir = resolve(workspaceDir, input.outputDir ?? defaultOutputDir);
  const docsDir = join(outputDir, 'docs');
  const [plan, tasks, packageRaw] = await Promise.all([
    readFile(join(workspaceDir, 'PLAN.md'), 'utf8'),
    readFile(join(workspaceDir, 'tasks.md'), 'utf8'),
    readFile(join(workspaceDir, 'package.json'), 'utf8')
  ]);
  const packageJson = JSON.parse(packageRaw) as PackageJson;
  const taskCount = tasks.split(/\r?\n/g).filter((line) => /^## Task \d+/.test(line)).length;
  const summary = planSummary(plan);

  await mkdir(docsDir, { recursive: true });
  const manifest = {
    generatedBy: 'docstube dogfood',
    generatedWith: packageJson.version ?? '0.0.0',
    reviewRequired: true,
    taskCount
  };
  const readme = [
    '# docstube dogfood docs',
    '',
    'This artifact is generated deterministically for review before any deploy step.',
    '',
    `- Version: ${packageJson.version ?? 'unknown'}`,
    `- Planned tasks: ${taskCount}`,
    '- Live agents: not used in this build',
    ''
  ].join('\n');
  const html = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    '<title>docstube dogfood docs</title>',
    '<style>',
    'body{font-family:Inter,system-ui,sans-serif;margin:0;background:#f7f7f4;color:#1f2933}',
    'main{max-width:920px;margin:0 auto;padding:48px 24px}',
    'h1{font-size:40px;line-height:1.1;margin:0 0 16px}',
    'section{border-top:1px solid #d8d7ce;padding:24px 0}',
    'table{border-collapse:collapse;width:100%;max-width:620px}',
    'th,td{text-align:left;border-bottom:1px solid #d8d7ce;padding:10px 12px}',
    'th{width:180px;color:#4b5563}',
    'code{background:#e8e7df;padding:2px 5px;border-radius:4px}',
    '</style>',
    '</head>',
    '<body>',
    '<main>',
    '<h1>docstube dogfood docs</h1>',
    '<p>This generated artifact is uploaded for review before deployment.</p>',
    '<section>',
    '<h2>Plan Summary</h2>',
    `<pre>${escapeHtml(summary)}</pre>`,
    '</section>',
    '<section>',
    '<h2>Build Facts</h2>',
    `<table>${packageRows(packageJson)}<tr><th>planned tasks</th><td>${taskCount}</td></tr></table>`,
    '</section>',
    '<section>',
    '<h2>Safety</h2>',
    '<p>No live agents or provider keys are used by this dogfood build.</p>',
    '</section>',
    '</main>',
    '</body>',
    '</html>',
    ''
  ].join('\n');

  const files = [join(outputDir, 'README.md'), join(outputDir, 'manifest.json'), join(docsDir, 'index.html')];
  await Promise.all([
    writeFile(files[0]!, readme, 'utf8'),
    writeFile(files[1]!, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
    writeFile(files[2]!, html, 'utf8')
  ]);
  return { files, outputDir };
};

const runDirectly = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;

if (runDirectly) {
  const result = await buildDogfoodDocs();
  console.info(`Built dogfood docs at ${result.outputDir}`);
}
