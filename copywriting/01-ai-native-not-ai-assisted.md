<!--
Variant 01 — "AI-native, not AI-assisted."
Lead angle: Category contrast (the whole site writes the docs vs. an AI helper bolted onto human authoring) + autonomy, with the verification gate as the trust spine that makes autonomy safe.
Tone: Confident and modern, anti-hype. The contrast and the autonomy/verification proof carry it, not the buzzword.
Primary persona: Broad — product teams and OSS maintainers.
Why it might win: It's the canonical statement of the founder's vision; the "not AI-assisted" half does work that "AI-native" alone can't.
Biggest risk: "AI-native" is a crowded phrase; differentiation lives entirely in the contrast, the autonomy, and the gate — keep those loud.
-->

## Hero

**H1 —** AI-native, not AI-assisted.

**Sub —** Other docs tools add an AI helper to a workflow where you still write the docs. docstube's agents write the whole site. It reads your codebase, drafts your docs, fact-checks every claim against the source, and keeps everything in sync as your code changes. Open source — and it runs on the AI you already pay for.

**Primary CTA —** Run the wizard: `npx docstube wizard`

**Secondary CTA —** Read how the gate works

**Hero visual —** Split frame. Left, labeled "AI-assisted": a human cursor typing into a half-empty doc with a small "suggest" popover. Right, labeled "AI-native": the docstube wizard with three named agents — Writer, Reviewer, Verifier — and a green "passed the gate" check on a finished page. The right side is doing all the work.

## Why docstube

- **Verified, not hallucinated.** Every factual claim is grounded in your source and machine-checked before it ships.
- **Always-current.** Change a function and only the pages that depend on it regenerate — locally or via a GitHub Action PR.
- **Written for your readers.** Name your personas; each page is reviewed for the right depth and tone.
- **Bring your own AI.** Runs on your existing Claude, Codex, or Gemini subscription, or any compatible API key — with spend caps you set. No separate docstube AI bill.
- **Complete.** Coverage is planned from a codemap, so the important surfaces get documented and the gaps get surfaced, not silently skipped.
- **Beautiful & modern.** A custom Astro + React theme with hosted-platform polish, themeable to your brand.
- **Open source.** MIT, generates MDX, zero lock-in.

## Use-cases

- **Public docs sites** — SEO- and AEO-friendly structure, built-in Pagefind search, llms.txt, and a docs-serving MCP, on a themeable site you own.
- **Internal docs & wikis** — onboarding, architecture, and tribal-knowledge capture on private repos, run on your own infra and keys.
- **Better LLM context** — verified llms.txt and llms-full.txt plus an MCP server give coding agents checked context, not raw concatenated source.

## How it works

1. Point docstube at your repo. A local web UI wizard opens.
2. Choose the doc type, define reader personas, add a little context.
3. A writer agent reads your code; reviewer and verifier agents check it for audience fit and accuracy.
4. Review the result rendered exactly as it'll look live, and leave feedback on any element.
5. The writer agent refines until you're happy.
6. On every code change, only the affected pages regenerate.

The wizard asks the minimum, then runs on its own. You steer only where you want to.

## The gate — why it's verified

Autonomy works here because nothing ships unchecked. Before any model judges a page, deterministic checks run: MDX compiles, component props validate, TS samples pass `tsc`, Python passes `pyright`, imports resolve against the real package, links resolve, D2 diagrams compile.

- If a code sample doesn't compile, the page doesn't ship.
- Imports resolve against the real package — phantom functions never reach the reader.
- The agent that writes the page isn't the agent that judges it; the verifier model family differs from the writer's.
- API tables are pulled from your types with TypeDoc and griffe, not written by an LLM. Signatures change, tables update — zero tokens.
- No page ships with an open blocker. That's not a policy — it's the build.

## Use your existing subscription

docstube runs on the coding agent you already pay for — the official Claude, Codex, or Gemini CLIs — or a direct-API adapter for any OpenAI- or Anthropic-compatible endpoint, so open-weight and self-hosted models fit as a config matter. It estimates vendor usage and freezes at the cap you set, with margin; runs are resumable, so you stay in control of spend.

Your source context goes only to the AI provider you already use, on your own credentials — never to docstube's servers.

## Built for the agent era

And of course, the output is agent-ready: llms.txt, llms-full.txt, and a docs-serving MCP server ship with the site, so the agents reading your docs get the same verified content your readers do.

## You own the output

The result is a self-contained Astro + React site, vendored into your repo with no runtime dependency on docstube. Eject it, theme it, host it anywhere. MIT-licensed, no lock-in.

## Footer credit

A small "Generated by docstube" credit is on by default. Turn it off whenever you like with `theme.attribution: false`.

## FAQ

**If the agents write everything, how do I trust it?** You trust the gate, not the model. Deterministic checks plus cross-vendor review clear before any page ships, and you review the rendered result before it goes live.

**Does my code leave my machine?** Source context goes only to the AI provider you already use, on your own credentials — never to docstube's servers.

**Which languages get full verification?** Any codebase works. TS/JS and Python are tier-1, with full verification and deterministic API extraction.

**What does it cost to run?** It uses the subscription or API key you already have, capped at the spend you configure. docstube itself is free and MIT.

## Final CTA

**Headline —** Stop assisting. Let the agents write — and prove it.

**CTA —** `npx docstube wizard`

**Microcopy —** MIT-licensed. Runs on your own AI. Nothing ships until it clears the gate.
