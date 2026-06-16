import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { printCheckResult, resultFailed } from '../check-result-output.ts';
import { defaultOutput } from '../cli-output.ts';
import type { CliCommandResult, CliOutput } from '../cli-output.ts';
import { listFilesRecursive, pathExists, toRelativePath } from '../workspace-paths.ts';
import { runValidateCommand } from './validate-command.ts';

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
  const files = await listFilesRecursive(docsRoot, ['.d2', '.mdx']);
  if (files.length === 0) {
    output.info(
      `No ${toRelativePath(workspaceDir, docsRoot)}/*.mdx or ${toRelativePath(workspaceDir, docsRoot)}/*.d2 files found.`
    );
  }

  const fileResults = await Promise.all(
    files.map((file) => {
      const kind = file.endsWith('.d2') ? 'd2' : 'mdx';
      return runCheckCommand({ file, kind, workspaceDir }, output);
    })
  );
  failedCount += fileResults.filter((result) => result.exitCode !== 0).length;

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
