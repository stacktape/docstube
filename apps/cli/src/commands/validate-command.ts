import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { printCheckResult, resultFailed } from '../check-result-output.ts';
import { defaultOutput } from '../cli-output.ts';
import type { CliCommandResult, CliOutput } from '../cli-output.ts';

export type ValidateCommandOptions = {
  configPath?: string;
  workspaceDir?: string;
};

export const runValidateCommand = async (
  options: ValidateCommandOptions = {},
  output: CliOutput = defaultOutput
): Promise<CliCommandResult> => {
  const workspaceDir = options.workspaceDir ?? process.cwd();
  const configPath = options.configPath ?? 'docstube.yml';
  try {
    const configText = await readFile(join(workspaceDir, configPath), 'utf8');
    const configRaw = parse(configText);
    const config = parse(configText) as { ia?: string; glossary?: string };
    const iaPath = typeof config.ia === 'string' ? config.ia : 'ia.yml';
    const glossaryPath = typeof config.glossary === 'string' ? config.glossary : 'glossary.yaml';
    const [iaRaw, glossaryRaw] = await Promise.all([
      readFile(join(workspaceDir, iaPath), 'utf8').then(parse),
      readFile(join(workspaceDir, glossaryPath), 'utf8').then(parse)
    ]);
    const { checkConfigFamily } = await import('@docstube/verifiers');
    const result = checkConfigFamily({ docstubeConfig: configRaw, ia: iaRaw, glossary: glossaryRaw });
    printCheckResult(output, result);
    return { exitCode: resultFailed(result) ? 1 : 0 };
  } catch (error) {
    output.error(error instanceof Error ? error.message : 'Validation failed.');
    return { exitCode: 1 };
  }
};
