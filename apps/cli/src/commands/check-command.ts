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

  if (await pathExists(join(workspaceDir, configPath))) {
    const validate = await runValidateCommand({ configPath, workspaceDir }, output);
    if (validate.exitCode !== 0) {
      failedCount += 1;
    }
  } else {
    output.info(`No ${configPath} found; skipping config-family.`);
  }

  const docsRoot = join(workspaceDir, 'docs');
  const files = await listFilesRecursive(docsRoot, ['.d2', '.mdx']);
  if (files.length === 0) {
    output.info('No docs/*.mdx or docs/*.d2 files found.');
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
