export type DocstubeWorkspacePackage =
  | '@docstube/agent'
  | '@docstube/codemap'
  | '@docstube/contracts'
  | '@docstube/core'
  | '@docstube/extractors'
  | '@docstube/skills'
  | '@docstube/theme'
  | '@docstube/verifiers';

export type DocstubeWorkspaceApp = '@docstube/action' | '@docstube/web' | '@docstube/web-ui' | 'docstube';

export const docstubeWorkspacePackages: DocstubeWorkspacePackage[] = [
  '@docstube/contracts',
  '@docstube/core',
  '@docstube/agent',
  '@docstube/verifiers',
  '@docstube/codemap',
  '@docstube/extractors',
  '@docstube/theme',
  '@docstube/skills'
];

export const docstubeWorkspaceApps: DocstubeWorkspaceApp[] = [
  'docstube',
  '@docstube/web-ui',
  '@docstube/action',
  '@docstube/web'
];

export const docstubeVersion = '0.0.2';

export const getDocstubePackageInfo = () => {
  return {
    apps: docstubeWorkspaceApps,
    packages: docstubeWorkspacePackages,
    version: docstubeVersion
  };
};
