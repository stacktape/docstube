import { defineConfig } from 'tsdown';

// @docstube/contracts stays private on npm, so its schemas/types are bundled into the published
// plugin-sdk dist instead of being an external dependency.
export default defineConfig({
  entry: ['src/plugin-sdk.ts'],
  format: 'esm',
  dts: true,
  clean: true,
  target: 'node24',
  noExternal: ['@docstube/contracts']
});
