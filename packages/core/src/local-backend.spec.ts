import { openDocstubeDatabase } from './db-migrations';
import { createLocalBackend } from './local-backend';
import { runStateBackendContract } from './state-backend-contract';

// LocalBackend must satisfy the shared StateBackend contract. A fresh in-memory SQLite database is
// migrated per case so the suite stays deterministic and isolated.
runStateBackendContract('LocalBackend (in-memory SQLite)', async () =>
  createLocalBackend(openDocstubeDatabase(':memory:'))
);
