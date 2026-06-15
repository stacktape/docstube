export type S0ContractArea =
  | 'adapter-event'
  | 'agent-adapter'
  | 'cache-key'
  | 'config'
  | 'criteria'
  | 'deterministic-check'
  | 'feedback'
  | 'generated-page'
  | 'manifest'
  | 'registry-component'
  | 'state-backend'
  | 'trpc-router';

export const s0ContractAreas = [
  'config',
  'criteria',
  'feedback',
  'manifest',
  'adapter-event',
  'cache-key',
  'deterministic-check',
  'generated-page',
  'state-backend',
  'agent-adapter',
  'registry-component',
  'trpc-router'
] as const satisfies readonly S0ContractArea[];
