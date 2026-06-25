<!--
Variant 09 — "Runs on the AI you already pay for."
Lead angle: Bring-your-own-AI as the hero — provider breadth (Claude/Codex/Gemini + any OpenAI-/Anthropic-compatible endpoint, incl. open-weight / non-US models and self-hosted), spend caps, and the exact privacy wording. The cost-and-control story leads; verification is the reason the autonomous runs you're paying for don't waste tokens on slop.
Tone: Practical, cost-aware, no-BS. Procurement-friendly without sounding like procurement.
Primary persona: Cost-conscious, privacy-sensitive teams choosing where their tokens and their source go.
Why it might win: It answers the two questions a skeptical buyer asks first — "what does this cost me to run?" and "where does my code go?" — before selling anything else.
Biggest risk: BYO-AI is a feature, not a vision; the page has to keep autonomy + the gate present so it reads as a product, not a config flag. And breadth must stay honest — no promising CLI integrations that don't exist.
-->

## Hero

**H1 —** Runs on the AI you already pay for.

**Sub —** docstube doesn't sell you tokens. Point it at the coding agent you're already paying for — Claude, Codex, or Gemini — or any OpenAI- or Anthropic-compatible API, and it reads your codebase, writes your docs, fact-checks every claim against the source, and keeps everything in sync as your code changes. Open source, your credentials, your spend cap.

**Primary CTA —** Connect your AI: `npx docstube wizard`

**Secondary CTA —** See the providers it supports

**Hero visual —** A provider picker in the wizard: rows for "Claude CLI," "Codex CLI," "Gemini CLI," and a highlighted "Custom endpoint" row with fields for base URL and model (placeholder text hints at Qwen / DeepSeek / a self-hosted host). Below it, a single line: "Spend cap: $40 — freezes at $36." A small lock icon sits beside "your credentials."

## Why docstube

- **Bring your own AI.** Your subscription or your API key does the work. There is no separate docstube AI bill — ever.
- **You set the ceiling.** docstube estimates vendor usage before it runs and freezes at the cap you configure, with margin. Runs resume where they stopped, so a docs build can't quietly drain a budget.
- **Verified, not hallucinated.** Tokens you pay for don't get spent shipping slop — every factual claim is grounded in your source and machine-checked before a page passes.
- **Always-current.** Change a function and only the pages that depend on it regenerate, so you're not re-paying to rewrite the whole site.
- **Written for your readers.** Name your personas; each page is reviewed for the right depth and tone.
- **Open source.** MIT, generates MDX, zero lock-in.

## Use-cases

- **Public docs sites** — a searchable, SEO- and AEO-friendly site with Pagefind, llms.txt, and an MCP server, generated on the credits you already buy.
- **Internal docs & wikis** — onboarding, architecture, and tribal knowledge for private repos, run entirely on your own infra and keys.
- **Better LLM context** — verified llms.txt and llms-full.txt plus an MCP server give your agents checked context, not raw concatenated source.

## How it works

1. Point docstube at your repo. A local web UI wizard opens.
2. Choose the doc type, define reader personas, add a little context — and pick which AI runs the job.
3. A writer agent reads your code; reviewer and verifier agents check it for audience fit and accuracy.
4. Review the result rendered exactly as it'll look live, and leave feedback on any element.
5. The writer agent refines until you're happy.
6. On every code change, only the affected pages regenerate.

The wizard asks the minimum, then runs on its own — on the model you chose, against the budget you set.

## Use your existing subscription

This is the part most tools get wrong, so here's the whole picture.

- **The official CLIs, built in.** docstube drives the Claude, Codex, and Gemini CLIs directly. If you already pay for one, you're done configuring.
- **Any compatible API.** A direct-API adapter points at any OpenAI- or Anthropic-compatible endpoint — give it a base URL and a model. That's the path for open-weight and non-US models like Qwen, DeepSeek, GLM, and Kimi, and for self-hosted endpoints behind your own firewall. They work as configuration, not as a special integration.
- **Your spend, capped.** docstube estimates vendor usage up front and freezes at your configured cap, with margin to spare. Hit the ceiling and the run pauses; restart it and it resumes — it never runs away with your bill.

So you choose the trade-off: the frontier model your team already trusts, a cheaper open-weight model for routine passes, or a self-hosted endpoint for source you won't send anywhere external.

## The gate — why it's verified

Paying per token makes verification a budget feature, not just a trust feature. A page that ships wrong is a page you paid to redo.

- If a code sample doesn't compile, the page doesn't ship — `tsc` for TypeScript, `pyright` for Python.
- Imports resolve against the real package, so phantom functions never reach the reader.
- Broken links, invalid MDX, and malformed D2 diagrams are machine-checked before any model weighs in.
- API tables are extracted from your types with TypeDoc and griffe, not written by an LLM — signatures change and the tables update for zero tokens.
- The agent that writes the page isn't the agent that judges it, and no page ships with an open blocker. That's not a policy — it's the build.

## Built for the agent era

The output is agent-ready too: llms.txt, llms-full.txt, and a docs-serving MCP server ship with the site, so the agents you already pay for can read the same verified docs your users do.

## You own the output

What you get is a self-contained Astro + React site, vendored into your repo with no runtime dependency on docstube. Host it on infrastructure you already pay for, theme it, or eject it entirely. MIT-licensed, no lock-in.

## Footer credit

A small "Generated by docstube" credit ships on by default. Set `theme.attribution: false` to remove it.

## FAQ

**Does docstube charge for the AI?** No. It runs on your subscription or your API key. docstube itself is free and MIT; the only AI cost is the one you already have, capped where you set it.

**Can I use a model that isn't Claude, Codex, or Gemini?** Yes, through the direct-API adapter — point it at any OpenAI- or Anthropic-compatible endpoint, including open-weight, non-US, and self-hosted models. You supply the base URL and model name.

**Where does my source code go?** Your source context goes only to the AI provider you already use, on your own credentials — never to docstube's servers.

**What stops a run from blowing the budget?** docstube estimates usage and freezes at your configured cap, with margin. Runs are resumable, so you cap spend without losing progress.

## Final CTA

**Headline —** Your AI. Your credentials. Your spend cap. Your docs.

**CTA —** `npx docstube wizard`

**Microcopy —** Open source. No second AI bill. Source goes only to the provider you already use — never to docstube's servers.
