// Public API of @docstube/theme — built-in registry components, the theme plugin core registers
// through the standard host API, and the self-contained Astro site emitter.

export { builtinComponents, builtinComponentNames } from './components.ts';
export { themePlugin } from './theme-plugin.ts';
export { default } from './theme-plugin.ts';
export { emitSite, defaultThemeTokens } from './emit-site.ts';
export type { EmitSiteInput, EmitSitePage } from './emit-site.ts';
