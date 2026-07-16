import type {
  ComponentDefinition,
  ContentSourceDefinition,
  DeployTargetDefinition,
  DocstubePlugin,
  ImporterDefinition,
  LanguagePackDefinition,
  PluginRegistrationHost,
  SearchProviderDefinition,
  VerifierDefinition
} from '@docstube/plugin-sdk';
import type { PluginCapabilityKind } from '@docstube/contracts';
import { pluginApiVersion } from '@docstube/contracts';
import { pluginLoadError } from '../errors.ts';

// The plugin host: the single door into the kernel (ARCHITECTURE.md §6). Built-in and external
// plugins register through exactly the same API — the host records provenance (`source`) but
// never branches on it.

export type PluginSource = 'builtin' | 'npm' | 'local';

export type RegisteredPlugin = {
  plugin: DocstubePlugin;
  source: PluginSource;
  specifier: string;
};

type Registration<T> = { definition: T; plugin: RegisteredPlugin };

export type PluginHost = {
  registerPlugin: (plugin: DocstubePlugin, source: PluginSource, specifier: string) => Promise<void>;
  plugins: () => RegisteredPlugin[];
  verifiers: () => Array<Registration<VerifierDefinition>>;
  languagePacks: () => Array<Registration<LanguagePackDefinition>>;
  contentSources: () => Array<Registration<ContentSourceDefinition>>;
  importers: () => Array<Registration<ImporterDefinition>>;
  deployTargets: () => Array<Registration<DeployTargetDefinition>>;
  searchProviders: () => Array<Registration<SearchProviderDefinition>>;
  components: () => Array<Registration<ComponentDefinition>>;
  warnings: () => string[];
};

const assertUnique = (kind: string, id: string, existing: Array<{ definition: { id?: string; name?: string } }>) => {
  const clash = existing.some((entry) => (entry.definition.id ?? entry.definition.name) === id);
  if (clash) {
    throw pluginLoadError(`duplicate ${kind} id "${id}" — another plugin already registered it`, { kind, id });
  }
};

export const createPluginHost = (): PluginHost => {
  const registered: RegisteredPlugin[] = [];
  const warnings: string[] = [];
  const verifiers: Array<Registration<VerifierDefinition>> = [];
  const languagePacks: Array<Registration<LanguagePackDefinition>> = [];
  const contentSources: Array<Registration<ContentSourceDefinition>> = [];
  const importers: Array<Registration<ImporterDefinition>> = [];
  const deployTargets: Array<Registration<DeployTargetDefinition>> = [];
  const searchProviders: Array<Registration<SearchProviderDefinition>> = [];
  const components: Array<Registration<ComponentDefinition>> = [];

  const registerPlugin = async (plugin: DocstubePlugin, source: PluginSource, specifier: string): Promise<void> => {
    const { manifest } = plugin;
    if (manifest.apiVersion !== pluginApiVersion) {
      throw pluginLoadError(
        `plugin "${manifest.name}" targets plugin API v${manifest.apiVersion}; this docstube supports v${pluginApiVersion}`,
        { plugin: manifest.name }
      );
    }
    const entry: RegisteredPlugin = { plugin, source, specifier };

    // Registrations are cross-checked against the manifest's declared capabilities: registering
    // something undeclared is an error (trust posture); declaring without registering is a warning.
    const declared = new Map<PluginCapabilityKind, Set<string>>();
    for (const capability of manifest.capabilities) {
      const ids = declared.get(capability.kind) ?? new Set<string>();
      for (const id of capability.ids) {
        ids.add(id);
      }
      declared.set(capability.kind, ids);
    }
    const seen = new Map<PluginCapabilityKind, Set<string>>();
    const checkDeclared = (kind: PluginCapabilityKind, id: string) => {
      if (!declared.get(kind)?.has(id)) {
        throw pluginLoadError(`plugin "${manifest.name}" registered undeclared ${kind} "${id}"`, {
          plugin: manifest.name,
          kind,
          id
        });
      }
      const ids = seen.get(kind) ?? new Set<string>();
      ids.add(id);
      seen.set(kind, ids);
    };

    const host: PluginRegistrationHost = {
      verifier: (definition) => {
        checkDeclared('verifier', definition.id);
        assertUnique('verifier', definition.id, verifiers);
        verifiers.push({ definition, plugin: entry });
      },
      languagePack: (definition) => {
        checkDeclared('language-pack', definition.id);
        assertUnique('language pack', definition.id, languagePacks);
        languagePacks.push({ definition, plugin: entry });
      },
      contentSource: (definition) => {
        checkDeclared('content-source', definition.id);
        assertUnique('content source', definition.id, contentSources);
        contentSources.push({ definition, plugin: entry });
      },
      importer: (definition) => {
        checkDeclared('importer', definition.id);
        assertUnique('importer', definition.id, importers);
        importers.push({ definition, plugin: entry });
      },
      deployTarget: (definition) => {
        checkDeclared('deploy-target', definition.id);
        assertUnique('deploy target', definition.id, deployTargets);
        deployTargets.push({ definition, plugin: entry });
      },
      searchProvider: (definition) => {
        checkDeclared('search-provider', definition.id);
        assertUnique('search provider', definition.id, searchProviders);
        searchProviders.push({ definition, plugin: entry });
      },
      component: (definition) => {
        checkDeclared('component', definition.name);
        assertUnique('component', definition.name, components);
        components.push({ definition, plugin: entry });
      }
    };

    await plugin.register(host);

    for (const [kind, ids] of declared) {
      for (const id of ids) {
        if (!seen.get(kind)?.has(id)) {
          warnings.push(`plugin "${manifest.name}" declared ${kind} "${id}" but never registered it`);
        }
      }
    }
    registered.push(entry);
  };

  return {
    registerPlugin,
    plugins: () => [...registered],
    verifiers: () => [...verifiers],
    languagePacks: () => [...languagePacks],
    contentSources: () => [...contentSources],
    importers: () => [...importers],
    deployTargets: () => [...deployTargets],
    searchProviders: () => [...searchProviders],
    components: () => [...components],
    warnings: () => [...warnings]
  };
};
