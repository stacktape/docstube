import { createRequire } from 'node:module';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DocstubeConfig } from '@docstube/contracts';
import { isDocstubePlugin } from '@docstube/plugin-sdk';
import { pluginLoadError } from '../errors.ts';
import type { PluginHost } from './plugin-host.ts';

// Built-in plugins go through the same registration path as external ones (dogfooding keeps the
// API honest, PRODUCT §3.4). Dynamic import keeps heavy deps (typescript, @mdx-js/mdx) off the
// CLI startup path.
export const registerBuiltinPlugins = async (host: PluginHost): Promise<void> => {
  const [verifiers, langTypescript, langPython] = await Promise.all([
    import('@docstube/verifiers'),
    import('@docstube/lang-typescript'),
    import('@docstube/lang-python')
  ]);
  await host.registerPlugin(verifiers.default, 'builtin', '@docstube/verifiers');
  await host.registerPlugin(langTypescript.default, 'builtin', '@docstube/lang-typescript');
  await host.registerPlugin(langPython.default, 'builtin', '@docstube/lang-python');
};

const importPluginModule = async (specifier: string, repoRoot: string): Promise<unknown> => {
  if (specifier.startsWith('.') || isAbsolute(specifier)) {
    // Local plugins are repo files; Node's type stripping lets users write them in TypeScript.
    // Absolute specifiers are already full paths — joining them onto repoRoot would corrupt them.
    return import(pathToFileURL(isAbsolute(specifier) ? specifier : join(repoRoot, specifier)).href);
  }
  // npm plugins are the *user's* dependency, resolved from the target repo — never from the
  // docstube installation (which may be a standalone binary).
  const requireFromRepo = createRequire(join(repoRoot, 'package.json'));
  const resolved = requireFromRepo.resolve(specifier);
  return import(pathToFileURL(resolved).href);
};

export const loadConfiguredPlugins = async (
  host: PluginHost,
  config: DocstubeConfig,
  repoRoot: string
): Promise<void> => {
  for (const specifier of config.plugins) {
    let moduleValue: unknown;
    try {
      moduleValue = await importPluginModule(specifier, repoRoot);
    } catch (error) {
      throw pluginLoadError(`failed to load plugin "${specifier}": ${(error as Error).message}`, { specifier });
    }
    const candidate = (moduleValue as { default?: unknown }).default;
    if (!isDocstubePlugin(candidate)) {
      throw pluginLoadError(
        `plugin "${specifier}" has no default export created with definePlugin() from @docstube/plugin-sdk`,
        { specifier }
      );
    }
    const source = specifier.startsWith('.') || isAbsolute(specifier) ? 'local' : 'npm';
    await host.registerPlugin(candidate, source, specifier);
  }
};
