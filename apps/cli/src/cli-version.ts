// Single source for the CLI-side tool version; release tooling rewrites this via set-version.
// Deliberately NOT imported from `@docstube/core`: the CLI entry must not pull the kernel in on
// startup (ARCHITECTURE §2), and `packages/core/src/version.ts` is kept in lockstep by set-version
// and asserted by package-manifest.spec.ts.
export const docstubeVersion = '0.0.2';
