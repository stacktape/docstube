import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage'
    },
    include: ['packages/**/*.{spec,test}.{ts,tsx}'],
    watch: false
  }
});
