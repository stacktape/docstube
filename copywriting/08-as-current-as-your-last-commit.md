<!--
Variant 08 — "As current as your last commit."
Lead angle: Always-current / efficient regeneration first (codemap → only-affected-pages → PR-the-diff). Verification is framed as what makes automatic refresh safe rather than scary.
Tone: Plainspoken, calm, matter-of-fact.
Primary persona: Fast-moving teams that refactor constantly and watch docs rot within a sprint.
Why it might win: It targets the most acute, recurring pain — docs that are stale by Friday — with a concrete mechanism, not a promise.
Biggest risk: "Automatic regeneration" can sound risky; the gate must immediately reframe auto-refresh as safe, not unchecked.
-->

## Hero

**H1 —** As current as your last commit.

**Sub —** Docs rot the moment the code moves. docstube tracks your code at the symbol level, so when something changes, only the pages that depend on it regenerate — and the GitHub Action opens a PR with just the diff and the reasons. Verified before it lands, so staying current never means shipping something wrong. Open source, and it runs on the AI you already pay for.

**Primary CTA —** Run the wizard: `npx docstube wizard`

**Secondary CTA —** See how regeneration works

**Hero visual —** A commit on the left (`refactor: rename createClient → initClient`) with an arrow to a small, scoped GitHub PR on the right: "2 pages changed," each line annotated with the reason ("signature changed"). Everything else in the tree is greyed out and untouched.

## Why docstube

- **Always-current.** Change a function and only the pages that depend on it regenerate — locally or via a GitHub Action PR.
- **Efficient regeneration.** Symbol-level provenance means a one-line change doesn't rerun your whole docs build, just the pages that actually moved.
- **Verified, not hallucinated.** Every factual claim is grounded in your source and machine-checked before it ships — which is what makes auto-refresh safe.
- **Bring your own AI.** Runs on your existing Claude, Codex, or Gemini subscription, or any compatible API key, with spend caps you set. No separate docstube AI bill.
- **Written for your readers.** Name your personas; each page is reviewed for the right depth and tone.
- **Beautiful & modern.** A custom Astro + React theme with hosted-platform polish, themeable to your brand.
- **Open source.** MIT, generates MDX, zero lock-in.

## Use-cases

- **Public docs sites** — SEO- and AEO-friendly structure, built-in Pagefind search, llms.txt, and a docs-serving MCP, on a themeable site you own, that keeps pace with main.
- **Internal docs & wikis** — onboarding and architecture docs that don't go stale the sprint after you write them, on private repos and your own keys.
- **Better LLM context** — verified llms.txt and llms-full.txt plus an MCP server give coding agents context that matches the current code, not last quarter's.

## How it works

1. Point docstube at your repo. A local web UI wizard opens.
2. Choose the doc type, define reader personas, add a little context.
3. A writer agent reads your code; reviewer and verifier agents check it for audience fit and accuracy.
4. Review the result rendered exactly as it'll look live, and leave feedback on any element.
5. The writer agent refines until you're happy.
6. On every code change, only the affected pages regenerate.

The wizard asks the minimum, then runs on its own. After that, your commits do the steering.

## How it stays current

docstube builds a tree-sitter codemap and records symbol-level provenance with normalized hashes, so it knows which page depends on which function. Change a symbol and only the pages tied to it regenerate — the rest are left exactly as they were. In CI, the GitHub Action opens a PR with only the changed pages and the reason each one changed. It never pushes silently; you review the diff like any other.

API reference tables are pulled straight from your types with TypeDoc and griffe. A signature changes, the table updates — no LLM, zero tokens.

## The gate — why auto-refresh is safe

Automatic regeneration is only calm if nothing ships unchecked. Before any model judges a page, deterministic checks run: MDX compiles, component props validate, TS samples pass `tsc`, Python passes `pyright`, imports resolve against the real package, links resolve, D2 diagrams compile.

- If a code sample doesn't compile, the page doesn't ship.
- Imports resolve against the real package — phantom functions never reach the reader.
- The agent that writes the page isn't the agent that judges it; the verifier model family differs from the writer's.
- No page ships with an open blocker. That's not a policy — it's the build.

A regenerated page clears the same gate as the first one. Current and checked, every time.

## Use your existing subscription

docstube runs on the coding agent you already pay for — the official Claude, Codex, or Gemini CLIs — or a direct-API adapter for any OpenAI- or Anthropic-compatible endpoint, so open-weight and self-hosted models fit as a config matter. It estimates vendor usage and freezes at the cap you set, with margin; runs are resumable, so you stay in control of spend.

Your source context goes only to the AI provider you already use, on your own credentials — never to docstube's servers.

## Built for the agent era

The output is agent-ready: llms.txt, llms-full.txt, and a docs-serving MCP server ship with the site, so the agents reading your docs get the same current, verified content your readers do.

## You own the output

The result is a self-contained Astro + React site, vendored into your repo with no runtime dependency on docstube. Eject it, theme it, host it anywhere. MIT-licensed, no lock-in.

## Footer credit

A small "Generated by docstube" credit is on by default. Turn it off whenever you like with `theme.attribution: false`.

## FAQ

**Does it regenerate the whole site on every change?** No. Symbol-level provenance means only the pages that depend on what changed regenerate; everything else is left as-is.

**Will it push docs to my repo on its own?** No. The GitHub Action opens a PR with only the changed pages and the reasons. You review and merge it.

**Is auto-refresh safe if AI wrote it?** A regenerated page clears the same deterministic checks and cross-vendor review as the original. Staying current never means skipping the gate.

**Does my code leave my machine?** Source context goes only to the AI provider you already use, on your own credentials — never to docstube's servers.

## Final CTA

**Headline —** Ship the commit. The docs follow.

**CTA —** `npx docstube wizard`

**Microcopy —** MIT-licensed. Runs on your own AI. Only the pages that changed regenerate — and only after they clear the gate.
