import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@docstube/action': resolve(rootDir, 'apps/github-action/src/github-action.ts'),
      '@docstube/agent': resolve(rootDir, 'packages/agent/src/agent.ts'),
      '@docstube/cli': resolve(rootDir, 'apps/cli/src/cli.ts'),
      '@docstube/codemap': resolve(rootDir, 'packages/codemap/src/codemap.ts'),
      '@docstube/contracts': resolve(rootDir, 'packages/contracts/src/contracts.ts'),
      '@docstube/core': resolve(rootDir, 'packages/core/src/core.ts'),
      '@docstube/extractors': resolve(rootDir, 'packages/extractors/src/extractors.ts'),
      '@docstube/install-events': resolve(rootDir, 'apps/install-events/src/install-events.ts'),
      '@docstube/skills': resolve(rootDir, 'packages/skills/src/skills.ts'),
      '@docstube/theme': resolve(rootDir, 'packages/theme/src/theme.ts'),
      '@docstube/verifiers': resolve(rootDir, 'packages/verifiers/src/verifiers.ts'),
      '@docstube/web': resolve(rootDir, 'apps/web/src/web.ts'),
      '@docstube/web-ui': resolve(rootDir, 'apps/local-ui/src/main.tsx')
    }
  },
  test: {
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage'
    },
    include: ['apps/**/*.{spec,test}.{ts,tsx}', 'packages/**/*.{spec,test}.{ts,tsx}'],
    watch: false
  }
});
