// Public API of @docstube/theme — built-in registry components, the theme plugin core registers
// through the standard host API, the multi-theme contract + built-in theme registry, and the
// self-contained Astro site emitter.

export { builtinComponents, builtinComponentNames } from './components.ts';
export { themePlugin } from './theme-plugin.ts';
export { default } from './theme-plugin.ts';
export { emitSite, tokensCss } from './emit-site.ts';
export type { EmitSiteInput, EmitSitePage, EmitSiteResult } from './emit-site.ts';
export { builtinThemes, builtinThemeNames, defaultThemeTokens, ThemeError } from './theme-manifest.ts';
export type {
  ThemeBuild,
  ThemeBundle,
  ThemeBundleFile,
  ThemeErrorCode,
  ThemeManifest,
  ThemeTokens
} from './theme-manifest.ts';
export { applyThemeBundle } from './apply-theme-bundle.ts';
export type {
  ApplyThemeBundleInput,
  ApplyThemeBundleResult,
  ThemeConflict,
  ThemeFilesManifest,
  ThemeOwnedFile
} from './apply-theme-bundle.ts';
export { guaranteeLabels } from './proof-source.ts';
