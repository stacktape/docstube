import { CoreError, loadConfigFamily } from '@docstube/core';
import type { CliCommandResult, CliOutput } from '../cli-output.ts';

export type ValidateCommandInput = {
  workspaceDir: string;
};

export const runValidateCommand = async (input: ValidateCommandInput, output: CliOutput): Promise<CliCommandResult> => {
  try {
    const family = await loadConfigFamily(input.workspaceDir);
    const pages = family.ia.tree.length;
    output.info(`docstube.yml OK — docType ${family.config.docType}, ${family.config.personas.length} persona(s)`);
    output.info(`ia.yml OK — ${pages} top-level node(s)`);
    output.info(`glossary — ${family.glossary.terms.length} term(s)`);
    return { exitCode: 0 };
  } catch (error) {
    if (error instanceof CoreError) {
      output.error(error.message);
      return { exitCode: 1 };
    }
    throw error;
  }
};
