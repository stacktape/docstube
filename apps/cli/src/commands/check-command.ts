import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { checkResultSchema } from '@docstube/contracts';
import { printCheckResult, resultFailed } from '../check-result-output.ts';
import { defaultOutput } from '../cli-output.ts';
import type { CliCommandResult, CliOutput } from '../cli-output.ts';
import { listFilesRecursive, pathExists, toRelativePath } from '../workspace-paths.ts';
import { runValidateCommand } from './validate-command.ts';
import type { CheckResult } from '@docstube/contracts';
import type { GeneratedMdxPage } from '@docstube/verifiers';

export type CheckCommandOptions = {
  file: string;
  kind: 'config' | 'd2' | 'mdx' | 'snippet';
  workspaceDir?: string;
};

export type CheckAllCommandOptions = {
  configPath?: string;
  runProjectDoctor?: (input: { configPath?: string; workspaceDir: string }) => Promise<{
    checks: readonly { id: string; message: string; status: string }[];
    ok: boolean;
  }>;
  workspaceDir?: string;
};

export const runCheckCommand = async (
  options: CheckCommandOptions,
  output: CliOutput = defaultOutput
): Promise<CliCommandResult> => {
  const workspaceDir = options.workspaceDir ?? process.cwd();
  const source = await readFile(options.file, 'utf8');
  const path = toRelativePath(workspaceDir, options.file);
  const { checkConfigFamily, checkD2, checkMdxCompiles, checkPythonSnippet, checkTypeScriptSnippet } =
    await import('@docstube/verifiers');
  const result =
    options.kind === 'd2'
      ? await checkD2({ path, source })
      : options.kind === 'mdx'
        ? await checkMdxCompiles({ path, body: source })
        : options.kind === 'snippet'
          ? path.endsWith('.py')
            ? await checkPythonSnippet({ path, code: source })
            : checkTypeScriptSnippet({ path, code: source })
          : checkConfigFamily({ docstubeConfig: parse(source) });

  printCheckResult(output, result);
  return { exitCode: resultFailed(result) ? 1 : 0 };
};

const frontmatterPattern = /^---\r?\n(?<frontmatter>[\s\S]*?)\r?\n---\r?\n?(?<body>[\s\S]*)$/u;

const readGeneratedMdxPage = async (workspaceDir: string, file: string): Promise<GeneratedMdxPage> => {
  const source = await readFile(file, 'utf8');
  const match = frontmatterPattern.exec(source);
  return {
    path: toRelativePath(workspaceDir, file),
    frontmatter: match ? parse(match.groups?.frontmatter ?? '') : {},
    body: match ? (match.groups?.body ?? '') : source
  };
};

const erroredCheckResult = (checkId: string, error: unknown): CheckResult =>
  checkResultSchema.parse({
    checkId,
    status: 'errored',
    error: error instanceof Error ? error.message : String(error)
  });

const runProjectCheck = async (
  checkId: string,
  run: () => CheckResult | Promise<CheckResult>,
  output: CliOutput
): Promise<number> => {
  const result = await Promise.resolve()
    .then(run)
    .catch((error) => erroredCheckResult(checkId, error));
  printCheckResult(output, result);
  return resultFailed(result) ? 1 : 0;
};

export const runCheckAllCommand = async (
  options: CheckAllCommandOptions = {},
  output: CliOutput = defaultOutput
): Promise<CliCommandResult> => {
  const workspaceDir = options.workspaceDir ?? process.cwd();
  const configPath = options.configPath ?? 'docstube.yml';
  let failedCount = 0;
  const configExists = await pathExists(join(workspaceDir, configPath));

  if (configExists) {
    const validate = await runValidateCommand({ configPath, workspaceDir }, output);
    if (validate.exitCode !== 0) {
      failedCount += 1;
    }
  } else {
    output.error(`No ${configPath} found. Run docstube wizard first.`);
    failedCount += 1;
  }

  const runProjectDoctor = options.runProjectDoctor ?? (await import('@docstube/core')).doctorProject;
  const doctor = await runProjectDoctor({ configPath, workspaceDir });
  for (const check of doctor.checks) {
    const line = `${check.id}: ${check.status} - ${check.message}`;
    if (check.status === 'failed') {
      output.error(line);
    } else {
      output.info(line);
    }
  }
  if (!doctor.ok) {
    failedCount += 1;
  }

  const docsRoot = join(workspaceDir, configExists ? await readConfiguredDocsRoot(workspaceDir, configPath) : 'docs');
  const mdxFiles = await listFilesRecursive(docsRoot, ['.mdx']);
  const d2Files = await listFilesRecursive(docsRoot, ['.d2']);
  if (mdxFiles.length === 0 && d2Files.length === 0) {
    output.info(
      `No ${toRelativePath(workspaceDir, docsRoot)}/*.mdx or ${toRelativePath(workspaceDir, docsRoot)}/*.d2 files found.`
    );
  }

  const mdxPages = await Promise.all(mdxFiles.map((file) => readGeneratedMdxPage(workspaceDir, file)));
  const relativeD2Files = d2Files.map((file) => toRelativePath(workspaceDir, file));
  const {
    checkGeneratedPageFrontmatter,
    checkPageAndSectionIds,
    d2CheckId,
    generatedFrontmatterCheckId,
    pageSectionIdCheckId
  } = await import('@docstube/verifiers');

  const frontmatterResults = await Promise.all(
    mdxPages.map((page) =>
      runProjectCheck(
        generatedFrontmatterCheckId,
        () => checkGeneratedPageFrontmatter({ path: page.path, frontmatter: page.frontmatter }),
        output
      )
    )
  );
  failedCount += frontmatterResults.reduce((total, count) => total + count, 0);

  if (mdxPages.length > 0) {
    failedCount += await runProjectCheck(
      pageSectionIdCheckId,
      () =>
        checkPageAndSectionIds({
          pageIds: mdxPages.map((page) => page.frontmatter.id),
          sectionsByPage: mdxPages.map((page) => ({
            pageId: page.frontmatter.id,
            sectionIds: Array.isArray(page.frontmatter.sections) ? page.frontmatter.sections : []
          }))
        }),
      output
    );
  }

  if (configExists) {
    const {
      collectProjectSourceFiles,
      createPageGenerationContext,
      createProjectPageVerifiers,
      loadProjectConfigFamily
    } = await import('@docstube/core');
    const family = await loadProjectConfigFamily(workspaceDir, configPath);
    const sources = await collectProjectSourceFiles({ config: family.config, workspaceDir });
    const context = await createPageGenerationContext({
      config: family.config,
      glossary: family.glossary,
      page: {
        id: 'overview',
        title: 'Project checks',
        slug: 'docs/src/pages/index.mdx',
        depth: 0,
        order: 0
      },
      sources,
      workspaceDir
    });
    const knownFiles = [
      ...sources.map((source) => source.path),
      ...mdxPages.map((page) => page.path),
      ...relativeD2Files
    ].toSorted((left, right) => left.localeCompare(right));
    const pageVerifiers = createProjectPageVerifiers({ context, knownFiles });
    const pageVerifierResults = await Promise.all(
      mdxPages.flatMap((page) =>
        pageVerifiers.map((verifier) => runProjectCheck(verifier.id, () => verifier.run(page), output))
      )
    );
    failedCount += pageVerifierResults.reduce((total, count) => total + count, 0);
  }

  const d2Results = await Promise.all(
    d2Files.map((file) => runCheckCommand({ file, kind: 'd2', workspaceDir }, output))
  );
  failedCount += d2Results.filter((result) => result.exitCode !== 0).length;
  if (d2Files.length === 0) {
    printCheckResult(output, checkResultSchema.parse({ checkId: d2CheckId, status: 'skipped', reason: 'no D2 files' }));
  }

  return { exitCode: failedCount > 0 ? 1 : 0 };
};

const readConfiguredDocsRoot = async (workspaceDir: string, configPath: string): Promise<string> => {
  try {
    const config = parse(await readFile(join(workspaceDir, configPath), 'utf8')) as {
      output?: { dir?: unknown };
    };
    if (typeof config.output?.dir !== 'string') {
      return 'docs';
    }

    const outputDir = config.output.dir.replaceAll('\\', '/');
    if (
      outputDir === '..' ||
      outputDir.startsWith('../') ||
      outputDir.startsWith('/') ||
      /^[A-Za-z]:/u.test(outputDir)
    ) {
      return 'docs';
    }
    return config.output.dir;
  } catch {
    return 'docs';
  }
};
