import type { PluginManifest } from '@docstube/contracts';
import { pluginManifestSchema } from '@docstube/contracts';
import type { PluginRegistrationHost } from './hook-types.ts';

// Brand so the host can tell a real plugin from an arbitrary default export.
export const pluginBrand = Symbol.for('docstube.plugin');

export type DocstubePlugin = {
  readonly [pluginBrand]: true;
  readonly manifest: PluginManifest;
  readonly register: (host: PluginRegistrationHost) => void | Promise<void>;
};

export type DefinePluginInput = Omit<PluginManifest, 'permissions'> & {
  permissions?: Partial<PluginManifest['permissions']> | undefined;
  register: (host: PluginRegistrationHost) => void | Promise<void>;
};

// The single entry point for plugin authors. Validates the manifest eagerly so a malformed plugin
// fails at load with a readable error, not deep inside a run.
export const definePlugin = (input: DefinePluginInput): DocstubePlugin => {
  const { register, ...manifestInput } = input;
  const manifest = pluginManifestSchema.parse(manifestInput);
  if (typeof register !== 'function') {
    throw new TypeError(`plugin "${manifest.name}": register must be a function`);
  }
  return Object.freeze({ [pluginBrand]: true as const, manifest, register });
};

export const isDocstubePlugin = (value: unknown): value is DocstubePlugin =>
  typeof value === 'object' && value !== null && (value as Record<PropertyKey, unknown>)[pluginBrand] === true;
