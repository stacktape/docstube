<!--
Variant 20 — "Stop writing docs. Stop trusting AI slop. Do both."
Lead angle: Bold contrarian manifesto fusing the two halves of the product — autonomy ("stop writing": the AI does it) and verification ("stop trusting slop": the gate decides what ships). Names the "AI slop" category (Merriam-Webster 2025 Word of the Year) and explicitly refuses to join it. High personality, opinionated, a little polarizing — every claim still maps to a real mechanism, and the FAQ openly declines to claim it "never hallucinates."
Tone: Sharp, opinionated, anti-hype at its edge. Picks a fight with the category, not with the reader.
Primary persona: Jaded developers who've been burned by AI tools that confidently shipped garbage.
Why it might win: It says out loud what the burned dev already believes — most AI docs tools produce slop — and then earns the right to be the exception with mechanism, not bravado.
Biggest risk: Attitude can tip into overclaiming. The edge has to stay anchored: name the gate, decline the forbidden claims explicitly, and let the build do the bragging.
-->

## Hero

**H1 —** Stop writing docs. Stop trusting AI slop. Do both.

**Sub —** Writing docs by hand is a tax. Letting an AI spray unverified text into your repo is worse. docstube does neither: its agents write the whole docs site, and a verification gate decides what actually ships. Code samples compile or they don't go in. Imports resolve against the real package or the page fails. Open source — and it runs on the AI you already pay for.

**Primary CTA —** Run the wizard: `npx docstube wizard`

**Secondary CTA —** See what the gate kills

**Hero visual —** A page being shoved toward "publish," stopped by a hard red gate. Tags on the rejected page: "import doesn't resolve," "sample won't compile." Behind the gate, a clean published page with a green check. The slop doesn't get through.

## We're not joining the slop pile

"AI slop" is Merriam-Webster's 2025 Word of the Year. That's not a coincidence — it's a description of most AI docs tooling. Confident prose, plausible code, phantom functions, examples that never ran. It reads fine until someone tries to use it.

docstube starts from the opposite assumption: an AI draft is guilty until checked. The writer agent produces a page, and then it has to survive a gate that doesn't care how fluent the prose is.

- **If a code sample doesn't compile, the page doesn't ship.** `tsc` for TypeScript, `pyright` for Python. No exceptions, no override.
- **Imports resolve against the real package** — phantom functions never reach the reader.
- **Broken links, invalid MDX, and malformed D2 diagrams are machine-checked** before a model gets an opinion.
- **The agent that writes isn't the agent that judges.** The verifier model family differs from the writer's, so they don't share the same blind spots.
- **API tables are pulled from your types, not written by an LLM.** TypeDoc and griffe. A signature changes, the table updates — zero tokens, zero room for invention.
- **No page ships with an open blocker.** That's not a policy you can talk your way around. It's the build.

That's the deal. The AI does the writing so you don't have to. The gate refuses the slop so you don't have to read it.

## Why this is allowed to be autonomous

Here's the part the hype merchants skip: autonomy is only safe because of the gate. "The AI writes your docs" is a threat when nothing checks it. It's a feature when every page clears deterministic checks plus cross-vendor review before it ships — and when you still review the rendered result and steer wherever you want.

We let the agents run because the build won't let bad pages out. Take away the gate and this is just another slop machine. We're not shipping that.

## Why docstube

- **Verified, not hallucinated.** Every factual claim is grounded in your source and machine-checked. The whole reason this page exists.
- **Always-current.** Change a function and only the dependent pages regenerate. The GitHub Action PRs the diff — it never pushes silently.
- **Written for your readers.** Name your personas; each page is reviewed for the right depth and tone, not generic filler.
- **Bring your own AI.** Runs on your Claude, Codex, or Gemini subscription, or any compatible API key, capped at the spend you set. No separate docstube AI bill.
- **Beautiful & modern.** A custom Astro + React theme with hosted-platform polish, themeable to your brand.
- **Open source.** MIT, generates MDX, zero lock-in.

## Use-cases

- **Public docs sites** — SEO- and AEO-friendly structure, Pagefind search, llms.txt, and a docs-serving MCP, on a themeable site you own — without hand-writing a word.
- **Internal docs & wikis** — onboarding, architecture, and tribal knowledge on private repos, run on your own infra and keys.
- **Better LLM context** — verified llms.txt and llms-full.txt plus an MCP server give coding agents checked context, not the raw concatenated slop they usually choke on.

## How it works

1. Point docstube at your repo. A local web UI wizard opens.
2. Choose the doc type, define reader personas, add a little context.
3. A writer agent reads your code; reviewer and verifier agents check it for audience fit and accuracy.
4. Review the result rendered exactly as it'll look live, and leave feedback on any element.
5. The writer agent refines until you're happy.
6. On every code change, only the affected pages regenerate.

The wizard asks the minimum, then runs on its own. You don't babysit it — the gate does.

## Use your existing subscription

docstube runs on the coding agent you already pay for — the official Claude, Codex, or Gemini CLIs — or a direct-API adapter for any OpenAI- or Anthropic-compatible endpoint, so open-weight and self-hosted models fit as a config matter. It estimates vendor usage and freezes at the cap you set, with margin; runs are resumable, so you stay in control of spend.

Your source context goes only to the AI provider you already use, on your own credentials — never to docstube's servers.

## You own the output

The result is a self-contained Astro + React site, vendored into your repo with no runtime dependency on docstube. Eject it, theme it, host it anywhere. MIT-licensed, no lock-in.

## Footer credit

A small "Generated by docstube" credit is on by default. Turn it off whenever you like with `theme.attribution: false`.

## FAQ

**So docstube never hallucinates?** No, and we won't pretend otherwise — any tool that promises that is selling you slop with confidence. What we guarantee is the gate: machine-checkable facts are machine-checked, code samples compile or the page fails, imports resolve, and no page ships with an open blocker. Editorial judgment is reviewed cross-vendor and surfaced to you, then you review the rendered result. That's a real boundary, not a slogan.

**Isn't "fully autonomous AI docs" exactly how slop happens?** Usually, yes — when nothing checks the output. Here, every page clears deterministic checks plus a cross-vendor reviewer before it ships, and you review the result. Autonomy is the payoff; the gate is the price of admission.

**What does the gate actually reject?** Non-compiling samples, unresolved imports and paths, broken internal and external links, invalid MDX, malformed D2 diagrams, and any page with an open blocker or major finding.

**Does my code leave my machine?** Source context goes only to the AI provider you already use, on your own credentials — never to docstube's servers.

## Final CTA

**Headline —** Let the AI write it. Make the gate prove it.

**CTA —** `npx docstube wizard`

**Microcopy —** MIT-licensed. Runs on your own AI. If it doesn't clear the gate, it doesn't ship — slop included.
