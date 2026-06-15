export type GitHubActionCommand = {
  configPath?: string;
  cwd: string;
  mode: 'generate' | 'update' | 'validate';
};

export const actionPackageName = '@docstube/action';
