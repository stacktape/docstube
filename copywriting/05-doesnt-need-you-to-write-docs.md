<!--
Variant 05 — "The docs tool that doesn't need you to write docs."
Lead angle: Category contrast, provocative. Names the "AI-assisted" status quo (a copilot that still makes you write) and offers the autonomous alternative — safe only because every page clears the verification gate.
Tone: Bold, a little confrontational, engineer-to-engineer.
Primary persona: Jaded devs who are sick of doc chores and skeptical of "AI docs."
Why it might win: The H1 is a pattern-interrupt; it reframes the whole category instead of competing inside it.
Biggest risk: Bold framing can read as hype — the gate section has to immediately ground the autonomy claim with hard checks.
-->

## Hero

**H1 —** The docs tool that doesn't need you to write docs.

**Sub —** Every other "AI docs" tool is a copilot: it autocompletes a sentence while you still do the writing. docstube isn't assisted — it's autonomous. Its agents read your codebase, draft the whole site, fact-check every claim against the source, and keep it in sync as your code changes. You supervise where you want to. Open source, and it runs on the AI you already pay for.

**Primary CTA —** Run the wizard: `npx docstube wizard`

**Secondary CTA —** See what clears the gate

**Hero visual —** A developer's empty "docs/" folder on the left with a blinking cursor and the caption "you, writing docs." On the right, the same folder full of finished, green-checked pages with the caption "docstube, while you ship features." No human cursor on the right side.

## Why docstube

- **You stop writing docs.** Name the doc type and your readers; the agents do the drafting. The chore you keep deferring just gets done.
- **Verified, not hallucinated.** Every factual claim is grounded in your source and machine-checked before it ships — the reason you can hand off the writing at all.
- **Bring your own AI.** Runs on the Claude, Codex, or Gemini subscription you already have, or any compatible API key, capped at the spend you set. No second AI bill.
- **Always-current.** Change a function and only the affected pages regenerate — locally or as a GitHub Action PR.
- **Written for your readers.** Define your personas; each page is reviewed for the right depth.
- **Beautiful & modern.** A custom Astro + React theme with hosted-platform polish, themeable to your brand.
- **Open source.** MIT, generates MDX, zero lock-in.

## Use-cases

- **Public docs sites** — SEO- and AEO-friendly structure, built-in Pagefind search, llms.txt, and a docs-serving MCP, on a themeable site you own.
- **Internal docs & wikis** — onboarding, architecture, and the tribal knowledge nobody has time to write down, on private repos and your own keys.
- **Better LLM context** — verified llms.txt and llms-full.txt plus an MCP server hand your coding agents checked context, not raw concatenated source.

## How it works

1. Point docstube at your repo. A local web UI wizard opens.
2. Pick the doc type, name your reader personas, add a little context. That's your part.
3. A writer agent reads your code; reviewer and verifier agents check it for audience fit and accuracy.
4. Review the result rendered exactly as it'll look live, and leave feedback on any element.
5. The writer agent refines until you're happy.
6. On every code change, only the affected pages regenerate.

The wizard asks the minimum, then runs on its own. The keyboard is yours only when you want it.

## The gate — why it's verified

"Autonomous" earns its keep because nothing ships unchecked. Before any model judges a page, deterministic checks run: MDX compiles, component props validate, TS samples pass `tsc`, Python passes `pyright`, imports resolve against the real package, links resolve, D2 diagrams compile.

- If a code sample doesn't compile, the page doesn't ship.
- Imports resolve against the real package — phantom functions never reach the reader.
- The agent that writes the page isn't the agent that judges it; the verifier model family differs from the writer's.
- API tables are pulled from your types with TypeDoc and griffe, not written by an LLM. Signatures change, tables update — zero tokens.
- No page ships with an open blocker. That's not a policy — it's the build.

Hands off the keyboard, not off the standard.

## Use your existing subscription

docstube runs on the coding agent you already pay for — the official Claude, Codex, or Gemini CLIs — or a direct-API adapter for any OpenAI- or Anthropic-compatible endpoint, so open-weight and self-hosted models fit as a config matter. It estimates vendor usage and freezes at the cap you set, with margin; runs are resumable, so you stay in control of spend.

Your source context goes only to the AI provider you already use, on your own credentials — never to docstube's servers.

## Built for the agent era

The output is agent-ready too: llms.txt, llms-full.txt, and a docs-serving MCP server ship with the site, so the agents reading your docs get the same verified content your readers do.

## You own the output

The result is a self-contained Astro + React site, vendored into your repo with no runtime dependency on docstube. Eject it, theme it, host it anywhere. MIT-licensed, no lock-in.

## Footer credit

A small "Generated by docstube" credit is on by default. Turn it off whenever you like with `theme.attribution: false`.

## FAQ

**If I'm not writing it, how do I trust it?** You trust the gate, not the model. Deterministic checks plus cross-vendor review clear before any page ships, and you review the rendered result before it goes live.

**Does my code leave my machine?** Source context goes only to the AI provider you already use, on your own credentials — never to docstube's servers.

**Which languages get full verification?** Any codebase works. TS/JS and Python are tier-1, with full verification and deterministic API extraction.

**What does it cost to run?** It uses the subscription or API key you already have, capped at the spend you configure. docstube itself is free and MIT.

## Final CTA

**Headline —** Let the agents write the docs. Keep your afternoon.

**CTA —** `npx docstube wizard`

**Microcopy —** MIT-licensed. Runs on your own AI. Nothing ships until it clears the gate.
