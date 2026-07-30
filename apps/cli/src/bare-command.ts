// Bare `docstube` IS the entry point (PRODUCT §3.9.1 / dx-knowledge-v2 decision 1): it opens the
// local control plane, which lands on first-run setup or the dashboard depending on whether this
// repository has a docstube.yml. Anything that looks like a command but is not one is a typo, and
// must say so rather than silently opening a UI the user did not ask for.
//
// Lives in its own module so it is testable — importing cli.ts would start the CLI.

export type BareCommandAction = 'control-plane' | { unknown: string };

// Takes PARSED positionals, not raw argv: `--port 4242` must not read as a command named "4242".
export const bareCommandAction = (positionals: readonly string[]): BareCommandAction => {
  const first = positionals.find((arg) => arg.length > 0);
  return first === undefined ? 'control-plane' : { unknown: first };
};
