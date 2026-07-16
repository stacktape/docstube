import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import {
  CoreError,
  auditFallbackConfig,
  configFileNames,
  createTaskRunnerFromConfig,
  parseDocstubeConfig,
  runAudit
} from '@docstube/core';
import type { AuditReport } from '@docstube/core';
import type { CliCommandResult, CliOutput } from '../cli-output.ts';

export type AuditCommandInput = {
  workspaceDir: string;
  docsDir: string;
  json?: boolean | undefined;
};

// Audit must work on arbitrary repos with no docstube setup (PRODUCT §2: the GTM wedge is running
// it on famous OSS repos). No docstube.yml → minimal fallback config (transport claude-cli, stub
// site/persona) instead of the config-missing error every other command raises.
const loadAuditConfig = async (workspaceDir: string, output: CliOutput, json: boolean) => {
  try {
    const text = await readFile(join(workspaceDir, configFileNames.config), 'utf8');
    return parseDocstubeConfig(text);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
    if (!json) {
      output.info(`no ${configFileNames.config} found — auditing with the default agent transport (claude-cli)`);
    }
    return auditFallbackConfig();
  }
};

const printReport = (report: AuditReport, output: CliOutput): void => {
  output.info(`pages audited:   ${report.pages}`);
  output.info(`claims:          ${report.claims}`);
  output.info(`  grounded:      ${report.grounded}`);
  output.info(`  unverifiable:  ${report.unverifiable}`);
  output.info(`defects:         ${report.defects.length}`);
  for (const defect of report.defects) {
    output.info(`  DEFECT  ${defect.file}: ${defect.reason}`);
    output.info(`          claim: ${defect.claimText}`);
  }
  for (const warning of report.warnings) {
    output.info(`  warn  ${warning}`);
  }
  output.info(`verified defects per 100 claims: ${report.defectsPer100Claims}`);
};

export const runAuditCommand = async (input: AuditCommandInput, output: CliOutput): Promise<CliCommandResult> => {
  try {
    const json = input.json === true;
    const config = await loadAuditConfig(input.workspaceDir, output, json);
    const runner = createTaskRunnerFromConfig(config, input.workspaceDir);
    if (!json) {
      output.info(`auditing with ${runner.transportId} (${runner.model})…`);
    }
    const docsDir = isAbsolute(input.docsDir) ? input.docsDir : join(input.workspaceDir, input.docsDir);
    const report = await runAudit({ repoRoot: input.workspaceDir, docsDir, runTask: runner.runTask });
    if (json) {
      output.info(JSON.stringify(report, null, 2));
    } else {
      printReport(report, output);
    }
    // Audit is a measuring device: a verified defect is a failure of the docs under test.
    return { exitCode: report.defects.length > 0 ? 1 : 0 };
  } catch (error) {
    if (error instanceof CoreError) {
      output.error(error.message);
      return { exitCode: 1 };
    }
    throw error;
  }
};
