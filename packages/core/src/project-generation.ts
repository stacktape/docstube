import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { openDocstubeDatabase } from './db-migrations.ts';
import { createLocalBackend } from './local-backend.ts';
import { initializeRunFromConfigFamily } from './pipeline-run.ts';

export type ProjectGenerationInitializationOptions = {
  configPath?: string;
  dbPath?: string;
  workspaceDir: string;
};

export type ProjectGenerationInitializationResult = {
  pagesCount: number;
  resumed: boolean;
  runId: string;
};

export const initializeProjectGeneration = async (
  input: ProjectGenerationInitializationOptions
): Promise<ProjectGenerationInitializationResult> => {
  const dbPath = input.dbPath ?? join(input.workspaceDir, '.docstube', 'db.sqlite');
  await mkdir(join(input.workspaceDir, '.docstube'), { recursive: true });
  const backend = createLocalBackend(openDocstubeDatabase(dbPath));
  try {
    const result = await initializeRunFromConfigFamily({
      backend,
      configPath: input.configPath,
      workspaceDir: input.workspaceDir
    });
    return {
      pagesCount: result.pages.length,
      resumed: result.resumed,
      runId: result.run.id
    };
  } finally {
    await backend.close();
  }
};
