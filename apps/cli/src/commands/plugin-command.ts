import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { examplePluginSource, exampleSpecSource, materializeBuiltInSkills } from '@docstube/skills';
import type { CliCommandResult, CliOutput } from '../cli-output.ts';
import { pathExists } from '../workspace-paths.ts';

// `docstube plugin scaffold <name>`: writes a working starter plugin from the plugin-authoring
// skill's worked example (single source of truth — the starter and the skill text can't drift)
// and materializes the skill so the user's own coding agent can take it from there (PRODUCT §3.4).

export type PluginCommandInput = {
  workspaceDir: string;
  action: string;
  name?: string | undefined;
};

const sanitizeName = (raw: string): string | undefined => {
  const name = raw
    .toLowerCase()
    .replace(/^docstube-plugin-/, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return name.length > 0 ? name : undefined;
};

export const runPluginCommand = async (input: PluginCommandInput, output: CliOutput): Promise<CliCommandResult> => {
  if (input.action !== 'scaffold') {
    output.error(`unknown plugin action "${input.action}" — expected: docstube plugin scaffold <name>`);
    return { exitCode: 1 };
  }
  const name = input.name === undefined ? undefined : sanitizeName(input.name);
  if (name === undefined) {
    output.error('usage: docstube plugin scaffold <name>  (e.g. `docstube plugin scaffold wordcount`)');
    return { exitCode: 1 };
  }

  const pluginsDir = join(input.workspaceDir, 'plugins');
  const pluginPath = join(pluginsDir, `${name}.ts`);
  if (await pathExists(pluginPath)) {
    output.error(`plugins/${name}.ts already exists — pick another name or remove it first`);
    return { exitCode: 1 };
  }
  await mkdir(pluginsDir, { recursive: true });
  const rename = (source: string | readonly string[]): string =>
    `${(typeof source === 'string' ? source : source.join('\n')).replaceAll('wordcount', name)}\n`.replace(
      /\n+$/u,
      '\n'
    );
  await writeFile(pluginPath, rename(examplePluginSource), 'utf8');
  await writeFile(join(pluginsDir, `${name}.spec.ts`), rename(exampleSpecSource), 'utf8');

  const skills = await materializeBuiltInSkills({
    targetDir: join(input.workspaceDir, '.docstube', 'skills'),
    skillIds: ['plugin-authoring']
  });

  output.info(`scaffolded plugins/${name}.ts and plugins/${name}.spec.ts`);
  output.info(
    `plugin-authoring skill ${skills[0]?.status === 'written' ? 'written' : 'already present'} at .docstube/skills/plugin-authoring/SKILL.md`
  );
  output.info('');
  output.info('Next steps:');
  output.info(`  1. Register it in docstube.yml:\n       plugins:\n         - ./plugins/${name}.ts`);
  output.info('  2. Point your coding agent at .docstube/skills/plugin-authoring/SKILL.md to evolve it.');
  output.info('  3. `docstube check --list` shows the check once the plugin registers a verifier.');
  return { exitCode: 0 };
};
