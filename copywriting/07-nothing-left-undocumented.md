<!--
Variant 07 — "Nothing important left undocumented."
Lead angle: The COMPLETE pillar. Autonomy means coverage humans never get around to; the codemap plans the information architecture and gaps are surfaced, not silently skipped. Honest "complete" = IA coverage + gap-surfacing.
Tone: Thorough, reassuring, methodical.
Primary persona: Teams with patchy, half-finished docs — the README is great, everything past it rots.
Why it might win: Speaks to the universal guilt of incomplete docs and offers coverage as the payoff of autonomy.
Biggest risk: "Complete" can overpromise — must lead with the honest definition (planned coverage + surfaced gaps), never literal perfection.
-->

## Hero

**H1 —** Nothing important left undocumented.

**Sub —** The docs you never get around to are the ones that matter. docstube plans coverage from a map of your codebase, drafts every page its agents can ground in real source, and tells you exactly where the gaps are instead of quietly skipping them. Open source — and it runs on the AI you already pay for.

**Primary CTA —** Run the wizard: `npx docstube wizard`

**Secondary CTA —** See how coverage is planned

**Hero visual —** A coverage map of a codebase: modules as nodes, most filled solid green ("documented"), a few outlined amber and labeled "gap: surfaced." A side panel reads "12 surfaces planned · 11 documented · 1 flagged for review." Honest, not a fake 100%.

## Why docstube

- **Complete.** Coverage is planned from a codemap, so the surfaces that matter get documented — and the gaps get surfaced, not silently skipped.
- **Verified, not hallucinated.** Every factual claim is grounded in your source and machine-checked before it ships.
- **Always-current.** Change a function and only the affected pages regenerate, so coverage doesn't decay the week after you finish.
- **Written for your readers.** Name your personas; each page is reviewed for the right depth and tone.
- **Bring your own AI.** Runs on your existing Claude, Codex, or Gemini subscription, or any compatible API key, with spend caps you set. No separate docstube AI bill.
- **Beautiful & modern.** A custom Astro + React theme with hosted-platform polish, themeable to your brand.
- **Open source.** MIT, generates MDX, zero lock-in.

## Use-cases

- **Internal docs & wikis** — onboarding, architecture, and the tribal knowledge that lives in three people's heads, captured on private repos and your own keys.
- **Public docs sites** — SEO- and AEO-friendly structure, built-in Pagefind search, llms.txt, and a docs-serving MCP, on a themeable site you own.
- **Better LLM context** — verified llms.txt and llms-full.txt plus an MCP server give coding agents checked context, not raw concatenated source.

## How it works

1. Point docstube at your repo. A local web UI wizard opens.
2. Choose the doc type, define reader personas, add a little context.
3. A writer agent reads your code; reviewer and verifier agents check it for audience fit and accuracy.
4. Review the result rendered exactly as it'll look live, and leave feedback on any element.
5. The writer agent refines until you're happy.
6. On every code change, only the affected pages regenerate.

The wizard asks the minimum, then runs on its own. Coverage is the agents' job, not your weekend's.

## Coverage you can see

docstube builds a tree-sitter codemap of your project and plans the information architecture from it, so the page list comes from what's actually in your code — not from what someone remembered to write. It can also run a drift report and tell you exactly where your existing docs disagree with the code. What it can't ground in source, it flags for review instead of inventing. Complete here means planned coverage plus surfaced gaps — honest, and visible.

## The gate — why it's verified

Coverage is worthless if it's wrong, so nothing ships unchecked. Before any model judges a page, deterministic checks run: MDX compiles, component props validate, TS samples pass `tsc`, Python passes `pyright`, imports resolve against the real package, links resolve, D2 diagrams compile.

- If a code sample doesn't compile, the page doesn't ship.
- Imports resolve against the real package — phantom functions never reach the reader.
- The agent that writes the page isn't the agent that judges it; the verifier model family differs from the writer's.
- API tables are pulled from your types with TypeDoc and griffe, not written by an LLM. Signatures change, tables update — zero tokens.
- No page ships with an open blocker. That's not a policy — it's the build.

## Use your existing subscription

docstube runs on the coding agent you already pay for — the official Claude, Codex, or Gemini CLIs — or a direct-API adapter for any OpenAI- or Anthropic-compatible endpoint, so open-weight and self-hosted models fit as a config matter. It estimates vendor usage and freezes at the cap you set, with margin; runs are resumable, so you stay in control of spend.

Your source context goes only to the AI provider you already use, on your own credentials — never to docstube's servers.

## Built for the agent era

The output is agent-ready: llms.txt, llms-full.txt, and a docs-serving MCP server ship with the site, so the agents reading your docs get the same verified, complete content your readers do.

## You own the output

The result is a self-contained Astro + React site, vendored into your repo with no runtime dependency on docstube. Eject it, theme it, host it anywhere. MIT-licensed, no lock-in.

## Footer credit

A small "Generated by docstube" credit is on by default. Turn it off whenever you like with `theme.attribution: false`.

## FAQ

**Does "complete" mean it documents everything?** It means the page plan is built from your codemap and the important surfaces get covered — and anything it can't ground in source is surfaced for review, not silently skipped.

**What about the docs we already have?** docstube can run a drift report and show you where your existing docs disagree with the current code, so you see the gaps before your readers do.

**Does my code leave my machine?** Source context goes only to the AI provider you already use, on your own credentials — never to docstube's servers.

**Which languages get full verification?** Any codebase works. TS/JS and Python are tier-1, with full verification and deterministic API extraction.

## Final CTA

**Headline —** Document the whole thing. Surface what's missing.

**CTA —** `npx docstube wizard`

**Microcopy —** MIT-licensed. Runs on your own AI. Nothing ships until it clears the gate.
