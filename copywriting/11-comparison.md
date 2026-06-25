<!--
Variant 11 — "Generated docs — actually verified, actually yours."
Lead angle: Comparison-led. A head-to-head table is the hero; the narrative frames docstube against the field on the two axes competitors tend to miss — verification after the model writes, and ownership of the output. docstube's rows are strict to PRODUCT FACTS; competitor rows are "as researched."
Tone: Evaluative, confident, fair. Reads like an honest bake-off, not a hit piece.
Primary persona: A buyer mid-comparison with three tabs open.
Why it might win: It meets the evaluator where they already are and wins on the axes most tools skip, instead of asking them to re-frame the category.
Biggest risk: Comparison pages age and invite "strawman" pushback; the as-researched footnote and an honest FAQ have to defend the framing, and docstube's own rows must stay scrupulously accurate.
-->

## Hero

**H1 —** Generated docs — actually verified, actually yours.

**Sub —** Plenty of tools will read a codebase and write docs. docstube is the one that fact-checks every claim against the source before it ships, runs on the AI you already pay for, and hands you a site you own outright. Open source, MIT, no lock-in.

**Primary CTA —** Compare it yourself: `npx docstube wizard`

**Secondary CTA —** Jump to the table

**Hero visual —** The comparison table below, rendered clean, with docstube's row pinned to the top and its "Verifies / fact-checks" and "Output" cells subtly highlighted as the columns where the field thins out.

## Same job — different ending

Same job: generate docs from a codebase. The difference is what happens *after* the model writes.

Most tools stop when the draft exists. docstube treats the draft as the starting point — it runs deterministic checks and a separate verifier pass, regenerates only what your code changes touch, and gives you the whole site as MDX you own. The table is where that shows up.

## The comparison

| Tool | Open source? | Reads your actual code? | Runs on your coding-agent subscription? | Verifies / fact-checks? | Incremental updates? | Output |
|---|---|---|---|---|---|---|
| **docstube** | **Yes (MIT)** | **Yes** | **Yes — Claude / Codex / Gemini, or any compatible API** | **Yes — verifier agents + deterministic checks** | **Yes — symbol-to-page provenance** | **MDX + self-contained Astro/React site you own** |
| DeepWiki (Cognition) | No | Yes | No — own models | Partial — grounded, can err | Re-indexes | Hosted wiki |
| DeepWiki-Open | Yes (MIT) | Yes | No — your API keys / Ollama | RAG-grounded | Re-generates | Wiki (Next.js) |
| Mintlify | No — platform | Via AI agent | No — metered AI credits | No explicit verifier | File-hash scan | MDX site (hosted) |
| Swimm | No | Yes | No — own backend | Auto-sync validation | Yes — code-coupled | Markdown in repo |
| Fern | Partial | No — spec-driven | No | Snippet audits (planned) | Spec-driven | Docs + SDKs |
| Repomix | Yes (MIT) | Packs code | Works with any subscription | No | n/a | Packed file for LLM context |

*Competitor details are as-researched and may change — check each vendor's current docs before deciding. docstube's row reflects what the tool does today.*

## Where docstube is different

- **It verifies after it writes.** A writer agent drafts, persona reviewers check fit, and a verifier agent plus deterministic checks fact-check the result. A page doesn't pass until blocker and major findings are clear. Most tools ground the model and stop there.
- **It runs on AI you already pay for.** The official Claude, Codex, and Gemini CLIs are built in, plus a direct-API adapter for any OpenAI- or Anthropic-compatible endpoint — including open-weight and self-hosted models. No metered, tool-specific AI credits.
- **It updates by symbol, not by file or re-index.** A tree-sitter codemap tracks symbol-level provenance, so changing one function regenerates only the pages that depend on it — and the GitHub Action opens a PR with just the diff and the reasons.
- **You own the output.** A self-contained Astro + React site, vendored into your repo. No hosted platform you rent, no runtime dependency, no lock-in.

## Why docstube

- **Verified, not hallucinated.** Grounded in source and machine-checked before shipping.
- **Always-current.** Only affected pages regenerate.
- **Written for your readers.** Persona reviewers gate each page for audience fit.
- **Bring your own AI.** Your subscription or key, with spend caps you set.
- **Beautiful & modern.** A custom, themeable Astro + React theme you own.
- **Open source.** MIT, MDX, zero lock-in.

## How it works

1. Point docstube at your repo. A local web UI wizard opens.
2. Choose the doc type, define reader personas, add a little context.
3. A writer agent reads your code; reviewer and verifier agents check it for audience fit and accuracy.
4. Review the result rendered exactly as it'll look live, and leave feedback on any element.
5. The writer agent refines until you're happy.
6. On every code change, only the affected pages regenerate.

## The gate — why it's verified

The "Verifies / fact-checks" column is the whole pitch, so here's what's behind docstube's cell.

- If a code sample doesn't compile, the page doesn't ship — `tsc` for TypeScript, `pyright` for Python.
- Imports resolve against the real package, so phantom functions never reach the reader.
- Broken links, invalid MDX, and malformed D2 diagrams are machine-checked.
- API tables are extracted from your types with TypeDoc and griffe, not written by an LLM.
- The agent that writes the page isn't the agent that judges it, and no page ships with an open blocker. That's not a policy — it's the build.

## Use your existing subscription

docstube runs on the coding agent you already pay for, or any OpenAI- or Anthropic-compatible API, and freezes at a spend cap you set, with margin; runs are resumable.

Your source context goes only to the AI provider you already use, on your own credentials — never to docstube's servers.

## You own the output

A self-contained Astro + React site, vendored into your repo with no runtime dependency on docstube. Eject it, theme it, host it anywhere. MIT-licensed, no lock-in.

## Footer credit

A small "Generated by docstube" credit ships on by default. Disable it with `theme.attribution: false`.

## FAQ

**Isn't this table a strawman?** It's meant to be fair, not flattering. Every tool here is good at what it's built for — Repomix packs context, Fern is spec-first, Mintlify is a polished hosted platform. The table compares them on the axes docstube optimizes for, and the footnote is honest that competitor details are as-researched and move. If a row is out of date, tell us and we'll fix it.

**Why compare against tools that solve a slightly different problem?** Because buyers evaluate them together. If you're choosing how to generate docs from code, these are the tabs you have open — so we put them side by side rather than pretend the field is empty.

**Are docstube's own rows accurate?** Yes — those reflect what the tool does today, not a roadmap. Verification, BYO-AI, symbol-level updates, and owned output all ship now.

**Does my code leave my machine?** Source context goes only to the AI provider you already use, on your own credentials — never to docstube's servers.

## Final CTA

**Headline —** Read the docs. Then read the table again.

**CTA —** `npx docstube wizard`

**Microcopy —** Open source. Verified before it ships. A site you own, not a platform you rent.
