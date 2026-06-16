import { parseCliVersionOutput, runAdapterProcess } from '@docstube/agent';
import type { AdapterProcessRunner } from '@docstube/agent';
import type { AgentChoice } from '@docstube/contracts';
import {
  defaultConfigPath,
  loadProjectConfigFamily,
  normalizeRelativePath,
  pathExists,
  projectDbPath,
  projectManifestPath,
  resolveWorkspacePath
} from './project-workspace.ts';

export type DoctorCheckStatus = 'failed' | 'passed' | 'skipped' | 'warning';

export type DoctorCheck = {
  id: string;
  message: string;
  status: DoctorCheckStatus;
};

export type ProjectDoctorOptions = {
  arch?: string;
  configPath?: string;
  nodeVersion?: string;
  platform?: string;
  runProcess?: AdapterProcessRunner;
  workspaceDir: string;
};

export type ProjectDoctorResult = {
  checks: DoctorCheck[];
  ok: boolean;
};

const minimumNode = [24, 12, 0] as const;

const parseNodeVersion = (version: string): [number, number, number] | null => {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/u.exec(version);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
};

const nodeVersionOk = (version: string): boolean => {
  const parsed = parseNodeVersion(version);
  if (!parsed) {
    return false;
  }

  for (const [index, minimum] of minimumNode.entries()) {
    if (parsed[index]! > minimum) {
      return true;
    }
    if (parsed[index]! < minimum) {
      return false;
    }
  }
  return true;
};

const uniqueAgentChoices = (choices: readonly (AgentChoice | undefined)[]): AgentChoice[] => {
  const byKey = new Map<string, AgentChoice>();
  for (const choice of choices) {
    if (!choice) {
      continue;
    }
    byKey.set(`${choice.adapter}:${choice.model ?? ''}:${choice.provider ?? ''}:${choice.baseUrl ?? ''}`, choice);
  }
  return [...byKey.values()];
};

const commandForAdapter = (choice: AgentChoice): { args: string[]; command: string } | null => {
  if (choice.adapter === 'api') {
    return null;
  }
  return { command: choice.adapter, args: ['--version'] };
};

const checkCliTool = async (input: {
  args: string[];
  command: string;
  id: string;
  runProcess: AdapterProcessRunner;
}): Promise<DoctorCheck> => {
  try {
    const result = await input.runProcess({
      command: input.command,
      args: input.args,
      timeoutMs: 5000
    });
    const combinedOutput = `${result.stdout}\n${result.stderr}`;
    if (result.exitCode !== 0 || result.timedOut) {
      return {
        id: input.id,
        status: 'warning',
        message: `${input.command} was not available or did not answer --version`
      };
    }

    const version = parseCliVersionOutput(combinedOutput);
    return {
      id: input.id,
      status: 'passed',
      message: version ? `${input.command} ${version}` : `${input.command} is available`
    };
  } catch {
    return {
      id: input.id,
      status: 'warning',
      message: `${input.command} was not found on PATH`
    };
  }
};

export const doctorProject = async (input: ProjectDoctorOptions): Promise<ProjectDoctorResult> => {
  const configPath = input.configPath ?? defaultConfigPath;
  const nodeVersion = input.nodeVersion ?? process.version;
  const platform = input.platform ?? process.platform;
  const arch = input.arch ?? process.arch;
  const runProcess = input.runProcess ?? runAdapterProcess;
  const checks: DoctorCheck[] = [
    {
      id: 'node-version',
      status: nodeVersionOk(nodeVersion) ? 'passed' : 'failed',
      message: `Node ${nodeVersion} (requires >=24.12.0)`
    },
    {
      id: 'platform',
      status: 'passed',
      message: `${platform}/${arch}`
    }
  ];
  const configAbsolutePath = resolveWorkspacePath(input.workspaceDir, normalizeRelativePath(configPath));
  const hasConfig = await pathExists(configAbsolutePath);

  if (!hasConfig) {
    checks.push({
      id: 'config',
      status: 'failed',
      message: `missing ${configPath}`
    });
    checks.push(
      await checkCliTool({ id: 'optional-tool-pyright', command: 'pyright', args: ['--version'], runProcess })
    );
    return { checks, ok: false };
  }

  try {
    const configFamily = await loadProjectConfigFamily(input.workspaceDir, configPath);
    checks.push({
      id: 'config',
      status: 'passed',
      message: `${configPath}, ${configFamily.ia.nav.length} top-level IA entries`
    });
    const manifestFound = await pathExists(projectManifestPath(input.workspaceDir));
    checks.push({
      id: 'manifest',
      status: manifestFound ? 'passed' : 'warning',
      message: manifestFound ? '.docstube/manifest.yml found' : '.docstube/manifest.yml missing; run docstube generate'
    });
    const stateFound = await pathExists(projectDbPath(input.workspaceDir));
    checks.push({
      id: 'local-state',
      status: stateFound ? 'passed' : 'skipped',
      message: stateFound ? '.docstube/db.sqlite found' : 'no local SQLite state yet'
    });
    checks.push(
      await checkCliTool({ id: 'optional-tool-pyright', command: 'pyright', args: ['--version'], runProcess })
    );

    const agentChecks = await Promise.all(
      uniqueAgentChoices([
        configFamily.config.agents.writer,
        configFamily.config.agents.reviewer,
        configFamily.config.agents.verifier
      ]).map(async (choice): Promise<DoctorCheck> => {
        const request = commandForAdapter(choice);
        if (!request) {
          return {
            id: 'agent-api',
            status: 'passed',
            message: 'direct API adapter configured; API keys are not inspected'
          };
        }
        return checkCliTool({
          id: `agent-${choice.adapter}`,
          command: request.command,
          args: request.args,
          runProcess
        });
      })
    );
    checks.push(...agentChecks);
  } catch (error) {
    checks.push({
      id: 'config',
      status: 'failed',
      message: error instanceof Error ? error.message : 'config validation failed'
    });
  }

  return {
    checks,
    ok: !checks.some((check) => check.status === 'failed')
  };
};
