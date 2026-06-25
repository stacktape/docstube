<!--
Variant 17 — "The best context your coding agent ever had."
Lead angle: The better-LLM-context use-case as hero — verified llms.txt / llms-full.txt + a docs-serving MCP server give Cursor, Claude, and Codex checked, structured context. Sharp contrast with raw codebase-packing tools (repomix style) that concatenate; docstube's context has cleared the same gate as the human docs. Autonomy gets it written; the gate is why the context is trustworthy.
Tone: Agent-era, technical, peer-to-peer with engineers who live in coding agents.
Primary persona: Teams whose developers work inside coding agents all day and feed them context constantly.
Why it might win: It reaches people who already feel the pain of pasting stale, unverified source into an agent and watching it hallucinate against their own codebase.
Biggest risk: "Context for agents" is adjacent to the product, not the whole product; the page must keep the docs-site value present so it reads as docstube, not a context-export side feature. And the repomix contrast must stay fair — those tools pack raw source on purpose; docstube's edge is that its context is checked, not that concatenation is useless.
-->

## Hero

**H1 —** The best context your coding agent ever had.

**Sub —** Your agents are only as good as what you feed them — and raw concatenated source is unverified by definition. docstube generates verified `llms.txt`, `llms-full.txt`, and a docs-serving MCP server from your codebase, so Cursor, Claude, and Codex read structured, fact-checked context instead of a wall of files. Every line cleared the same gate as your human docs. Open source — and it runs on the AI you already pay for.

**Primary CTA —** Run the wizard: `npx docstube wizard`

**Secondary CTA —** See what the agent reads

**Hero visual —** Two inputs feeding one coding-agent chat. Top, labeled "packed source": a dense blob of concatenated files with a frayed edge. Bottom, labeled "docstube": a clean `llms-full.txt` with section anchors and a small green "passed the gate" check, plus an MCP icon. The agent's reply on the right cites a real function by its actual signature.

## Why this beats packing the repo

Context tools that concatenate your repository do something useful: they get a lot of source in front of the model fast. But concatenation can't tell the model which parts are true, which are dead code, or which example never compiled. The model gets volume, not judgment.

docstube's context is the same content as your docs site — and it cleared the same checks before it shipped.

- **Verified, not concatenated.** Every claim in the context was grounded in your source and machine-checked. Raw packing skips that step entirely.
- **Structured, not flattened.** Personas, sections, and stable IDs give the agent navigable context, not one undifferentiated stream of tokens.
- **Current, not a snapshot.** When code changes, the affected context regenerates — so the file you hand your agent matches the code it's reasoning about.
- **API tables from your types.** Signatures come from TypeDoc and griffe, not from a model — so the agent never reads a hallucinated parameter list.

## What ships for agents

- **`llms.txt`** — a compact, structured index of your docs, built to the emerging convention agents already look for.
- **`llms-full.txt`** — the full verified corpus in one file, for agents that want everything in context at once.
- **A docs-serving MCP server** — your agents query your docs as a tool, pulling exactly the verified page they need instead of you pasting it.

All three carry the same content your human readers get, because they're generated from the same gated pipeline. There's no second, lower-quality "for the robots" copy.

## Use-cases

- **Better LLM context** — checked `llms.txt`, `llms-full.txt`, and MCP so your agents reason over verified docs, not raw source. This page's whole point.
- **Public docs sites** — the same verified content also renders as a searchable, SEO- and AEO-friendly site with Pagefind on a themeable theme you own.
- **Internal docs & wikis** — feed your team's agents accurate context on private architecture and tribal knowledge, run on your own infra and keys.

## How it works

1. Point docstube at your repo. A local web UI wizard opens.
2. Choose the doc type, define reader personas, add a little context.
3. A writer agent reads your code; reviewer and verifier agents check it for audience fit and accuracy.
4. Review the result rendered exactly as it'll look live, and leave feedback on any element.
5. The writer agent refines until you're happy.
6. On every code change, only the affected pages regenerate — and the agent context regenerates with them.

The wizard asks the minimum, then runs on its own. The `llms.txt`, `llms-full.txt`, and MCP server come out of the same pass.

## The gate — why the context is trustworthy

Context for an agent is only worth feeding if it's true. That's the entire difference here, so it's worth being precise about what "verified" means. Before any model judges a page, deterministic checks run.

- If a code sample doesn't compile, it doesn't reach the context — `tsc` for TypeScript, `pyright` for Python.
- Imports resolve against the real package, so phantom functions never end up in `llms-full.txt`.
- Broken links, invalid MDX, and malformed D2 diagrams are machine-checked before any model weighs in.
- The agent that writes the page isn't the agent that judges it; the verifier model family differs from the writer's.
- No page ships with an open blocker. That's not a policy — it's the build.

What your coding agent reads has cleared every one of those checks. That's context you can let it act on.

## Use your existing subscription

docstube runs on the coding agent you already pay for — the official Claude, Codex, or Gemini CLIs — or a direct-API adapter for any OpenAI- or Anthropic-compatible endpoint, so open-weight and self-hosted models fit as a config matter. It estimates vendor usage and freezes at the cap you set, with margin; runs are resumable, so you stay in control of spend.

Your source context goes only to the AI provider you already use, on your own credentials — never to docstube's servers.

## You own the output

The docs site and the agent context are a self-contained Astro + React build, vendored into your repo with no runtime dependency on docstube. The `llms.txt`, `llms-full.txt`, and MCP server are yours to host wherever your agents reach them. MIT-licensed, no lock-in.

## Footer credit

A small "Generated by docstube" credit is on by default. Turn it off whenever you like with `theme.attribution: false`.

## FAQ

**How is this different from a repo-packing tool?** Those concatenate raw source — fast, but unverified. docstube's context is the same content as your verified docs: grounded in source, machine-checked, and structured by persona and section before it ships.

**Do agents and humans get the same content?** Yes. `llms.txt`, `llms-full.txt`, and the MCP server are generated from the same gated pipeline as the rendered site. There's no separate low-quality copy for machines.

**Does the context stay current?** When code changes, only the affected pages regenerate — and the agent context regenerates with them, so it matches the code your agent is reasoning about.

**Does my code leave my machine?** Source context goes only to the AI provider you already use, on your own credentials — never to docstube's servers.

## Final CTA

**Headline —** Stop pasting raw source. Hand your agent checked context.

**CTA —** `npx docstube wizard`

**Microcopy —** MIT-licensed. Runs on your own AI. `llms.txt`, `llms-full.txt`, and MCP — all cleared the same gate as your docs.
