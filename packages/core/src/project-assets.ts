import { writeGeneratedSiteAssets } from '@docstube/theme';
import type { DocstubeConfig, Glossary, Ia, RelativePath } from '@docstube/contracts';
import { normalizeRelativePath, resolveWorkspacePath } from './project-workspace.ts';

export type ProjectAssetRefreshResult =
  | { status: 'refreshed'; files: RelativePath[] }
  | { status: 'skipped'; reason: string };

export const refreshGeneratedSiteAssets = async (input: {
  config: DocstubeConfig;
  glossary: Glossary;
  ia: Ia;
  workspaceDir: string;
}): Promise<ProjectAssetRefreshResult> => {
  const outputRoot = resolveWorkspacePath(input.workspaceDir, input.config.output.dir);
  const written = await writeGeneratedSiteAssets(outputRoot, {
    credit: input.config.theme?.credit,
    glossary: input.glossary,
    ia: input.ia,
    siteDescription: input.config.site.description,
    siteName: input.config.site.name,
    siteUrl: input.config.site.url
  });

  return {
    status: 'refreshed',
    files: written.files.map((file) => normalizeRelativePath(`${input.config.output.dir}/${file}`))
  };
};
