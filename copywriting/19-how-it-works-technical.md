<!--
Variant 19 — "How docstube writes — and verifies — every page."
Lead angle: Technical / how-it-works. Expands the founder's 6 steps into the real pipeline — writer → persona reviewers → verifier + deterministic gate → retry/refine → provenance/refresh — lists the full deterministic check set, and includes an honest "what this does and doesn't guarantee" section drawing the line between machine-checked facts and prose judgment. Spec-like, low-marketing.
Tone: Precise, understated, documentation-like. Closer to a README than a landing page.
Primary persona: Skeptical staff / principal engineers who want to see the machinery before they'll read a pitch.
Why it might win: For the engineer evaluating the tool, the mechanism IS the pitch; showing the limits honestly buys more trust than any adjective.
Biggest risk: A how-it-works page can drift into a literal spec and lose the autonomy + gate spine; the framing must keep "bounded autonomy" front and center, and the honest-limits section must not undersell to the point of un-selling.
-->

## Hero

**H1 —** How docstube writes — and verifies — every page.

**Sub —** docstube's agents write your whole docs site autonomously — but autonomy here is bounded by a gate, not a leap of faith. This is the actual pipeline: who writes, who reviews, what's machine-checked, what happens on a failure, and — plainly — what this does and doesn't guarantee. Open source, and it runs on the AI you already pay for.

**Primary CTA —** Run the wizard: `npx docstube wizard`

**Secondary CTA —** Jump to what it guarantees

**Hero visual —** A horizontal pipeline diagram: `Codemap → Writer → Persona Reviewers → Verifier + Deterministic checks → [pass] Ship / [fail] Refine → Provenance`. The "Deterministic checks" node is expanded into a small checklist (tsc, pyright, MDX, links, D2). A loop arrow runs from "fail" back to "Writer."

## The pipeline, step by step

1. **Map.** A tree-sitter codemap parses your repo and plans coverage — which surfaces become pages and how they fit into the information architecture. Gaps are surfaced, not silently skipped.
2. **Write.** A writer agent drafts each page as MDX, reading the real source. Prose, structure, and examples come from the model; API reference tables do not (see below).
3. **Review for fit.** One reviewer agent per persona checks each page for audience fit — right depth, right tone, right assumptions for the reader you named.
4. **Verify the facts.** A verifier agent plus a deterministic check suite fact-check every claim against the source. The verifier model family differs from the writer's by default — the agent that writes is not the agent that judges.
5. **Gate.** A page does not pass while a blocker or major finding is open. On a failure, the finding goes back to the writer, which refines and resubmits. The loop repeats until the page clears.
6. **Provenance and refresh.** Each page records symbol-level provenance via normalized hashes. When a symbol changes, only the pages that depend on it regenerate — locally, or as a GitHub Action PR that contains only the changed pages and the reason each one changed. It never pushes silently.

The wizard asks the minimum up front — doc type, personas, a little context — then runs the loop on its own. You review the rendered result and leave element-level feedback wherever you want to steer.

## The deterministic checks

These run before any model judges a page. They are pass/fail and don't consult an LLM:

- **MDX compiles.** Invalid MDX never reaches the reader.
- **Component props validate.** Theme components are checked against their contracts.
- **TypeScript samples pass `tsc`.** A non-compiling TS sample fails the page.
- **Python samples pass `pyright`.** Same rule, Python side.
- **Imports and paths resolve against the real package.** Phantom functions and made-up module paths fail.
- **Internal and external links resolve.** Dead links are caught at build, not by readers.
- **D2 diagrams compile.** Malformed diagrams fail. (D2 only — no Mermaid.)
- **Glossary integrity, page/section IDs, and API-reference consistency** are validated.

**API reference tables are extracted deterministically** — TypeDoc for TS/JS, griffe for Python — not written by an LLM. Change a signature and the table updates for zero tokens.

Tier-1 language support with full verification: TypeScript/JavaScript and Python.

## What this does and doesn't guarantee

Honesty matters more than marketing on this page, so here is the line.

**What the gate guarantees.** Machine-checkable facts are machine-checked. Code samples in tier-1 languages compile. Imports resolve. Links resolve. MDX and diagrams compile. API tables match your types. No page ships with an open blocker — that's the build, not a policy.

**What it does not guarantee.** docstube does not claim to "never hallucinate" or be "100% accurate." Prose judgment — whether an explanation is the *clearest* one, whether the framing is ideal, whether a nuance is worth including — is reviewed by a cross-vendor agent and surfaced to you, but it is editorial, not provable. The deterministic gate constrains facts; it does not certify taste. That's why you review the rendered result before it goes live, and why feedback and refine exist.

This is the whole point of bounded autonomy: the agents do the writing so you don't have to, and the gate plus your review are what let you stop supervising the parts a machine can actually verify.

## Use-cases

- **Public docs sites** — SEO- and AEO-friendly structure, Pagefind search, llms.txt, and a docs-serving MCP, on a themeable site you own.
- **Internal docs & wikis** — onboarding, architecture, and tribal knowledge on private repos, run on your own infra and keys.
- **Better LLM context** — verified llms.txt and llms-full.txt plus an MCP server give coding agents checked context, not raw concatenated source.

## Use your existing subscription

docstube runs on the coding agent you already pay for — the official Claude, Codex, or Gemini CLIs — or a direct-API adapter for any OpenAI- or Anthropic-compatible endpoint, so open-weight and self-hosted models fit as a config matter. It estimates vendor usage and freezes at the cap you set, with margin; runs are resumable, so you stay in control of spend.

Your source context goes only to the AI provider you already use, on your own credentials — never to docstube's servers.

## You own the output

The result is a self-contained Astro + React site, vendored into your repo with no runtime dependency on docstube. Eject it, theme it, host it anywhere. MIT-licensed, no lock-in.

## Footer credit

A small "Generated by docstube" credit is on by default. Turn it off whenever you like with `theme.attribution: false`.

## FAQ

**What happens when a page fails a check?** The finding is returned to the writer agent, which refines and resubmits. The page doesn't pass while a blocker or major finding is open, so the loop repeats until it clears.

**Are the API tables written by the model?** No. They're extracted from your types with TypeDoc and griffe. Signatures change, the tables update — zero tokens, no model involved.

**Why is the verifier a different model?** Cross-vendor judging reduces shared blind spots: the agent that writes a page isn't the one that judges it, and the verifier model family differs from the writer's by default.

**Does it regenerate everything on a change?** No. Symbol-level provenance means only pages that depend on what changed regenerate; the rest are left untouched.

**Does my code leave my machine?** Source context goes only to the AI provider you already use, on your own credentials — never to docstube's servers.

## Final CTA

**Headline —** Read the machinery. Then run it.

**CTA —** `npx docstube wizard`

**Microcopy —** MIT-licensed. Runs on your own AI. Facts are machine-checked; you review the rest.
