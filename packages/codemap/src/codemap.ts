export type SupportedCodemapLanguage = 'javascript' | 'python' | 'typescript';

export type CodemapSymbol = {
  filePath: string;
  id: string;
  language: SupportedCodemapLanguage;
  normalizedHash: string;
};

export const tierOneCodemapLanguages = ['javascript', 'typescript', 'python'] as const;
