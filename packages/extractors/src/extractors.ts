export type ApiExtractorId = 'griffe' | 'typedoc';

export type ApiReferenceSymbol = {
  id: string;
  name: string;
  sourcePath: string;
};

export const builtInApiExtractorIds = ['typedoc', 'griffe'] as const;
