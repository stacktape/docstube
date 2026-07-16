import { describe, expect, it } from 'vitest';
import { isDocstubePlugin } from '@docstube/plugin-sdk';
import type { ComponentDefinition, PluginRegistrationHost } from '@docstube/plugin-sdk';
import { builtinComponentNames, builtinComponents } from './components.ts';
import themePluginDefault, { themePlugin } from './theme-plugin.ts';

const buildFakeHost = (): { host: PluginRegistrationHost; components: ComponentDefinition[] } => {
  const components: ComponentDefinition[] = [];
  const host: PluginRegistrationHost = {
    verifier: () => {},
    languagePack: () => {},
    contentSource: () => {},
    importer: () => {},
    deployTarget: () => {},
    searchProvider: () => {},
    component: (definition) => {
      components.push(definition);
    }
  };
  return { host, components };
};

describe('themePlugin', () => {
  it('is a branded plugin with a validated manifest', () => {
    expect(isDocstubePlugin(themePlugin)).toBe(true);
    expect(themePluginDefault).toBe(themePlugin);
    expect(themePlugin.manifest.name).toBe('@docstube/theme');
    expect(themePlugin.manifest.version).toBe('0.0.2');
    expect(themePlugin.manifest.apiVersion).toBe(1);
    expect(themePlugin.manifest.capabilities).toEqual([{ kind: 'component', ids: builtinComponentNames }]);
  });

  it('registers every builtin component against the host', async () => {
    const { host, components } = buildFakeHost();
    await themePlugin.register(host);
    expect(components.map((component) => component.name)).toEqual(builtinComponents.map((component) => component.name));
    expect(components).toHaveLength(builtinComponents.length);
  });
});
