<!--
Variant 13 — "Every claim, checked against your code."
Lead angle: The verification gate as the hero. The mechanism→claim palette is the centerpiece, expanded into the page's spine. Autonomy is framed narrowly: safe to run unattended because the gate is binary — a page either clears it or it doesn't ship.
Tone: Anti-hype, precise, understated. Let the mechanisms speak; no adjectives doing the work a check should do.
Primary persona: Skeptical senior/staff engineers who assume AI docs are slop until shown the enforcement.
Why it might win: It answers the only objection that matters to this reader — "how do I know it's not making things up" — with build steps, not promises.
Biggest risk: Going so deep on the gate that the rest of the product (autonomy, ownership, BYO AI) disappears; keep Why/How present but clearly subordinate.
-->

## Hero

**H1 —** Every claim, checked against your code.

**Sub —** docstube's agents write your whole docs site, then prove it. Every code sample compiles, every import resolves against the real package, every link and diagram is machine-checked, and a second model family reviews what the first one wrote. A page that fails any of it doesn't ship. Open source — and it runs on the AI you already pay for.

**Primary CTA —** Run the wizard: `npx docstube wizard`

**Secondary CTA —** Read every check it runs

**Hero visual —** A single docs page on the left. On the right, a vertical checklist running top to bottom: "MDX compiles ✓ · props validate ✓ · `tsc` passes ✓ · `pyright` passes ✓ · imports resolve ✓ · links resolve ✓ · D2 compiles ✓ · cross-vendor review ✓". One amber row mid-list — "import `parseConfg` not found in package" — and a status bar reading "blocked: 1 finding · not shipped." The page is held, not published.

## Trust the gate, not the model

Most AI docs tools ask you to trust the writer. docstube asks you to trust the check. The distinction is the whole product.

A language model drafts the page. Then a separate, deterministic build decides whether the page is allowed to exist. It runs the same checks every time, it doesn't get tired, and it doesn't grade on a curve. If a claim can't survive the check, the claim doesn't reach your reader — the model's confidence has nothing to do with it.

That's also why you can let it run unattended. The gate is binary: a page either clears every blocker or it stays unpublished. You're not trusting an agent to be right — you're trusting a build to refuse anything that isn't.

## What "checked" actually means

These run before any model is allowed to judge the page, and again on every regeneration:

- **If a code sample doesn't compile, the page doesn't ship.** TypeScript samples go through `tsc`; Python goes through `pyright`. Snippets aren't decoration — they're build inputs.
- **Imports resolve against the real package — phantom functions never reach the reader.** A call to a method that doesn't exist in your code is a hard failure, not a stylistic note.
- **Broken links, invalid MDX, and malformed diagrams are machine-checked.** Internal and external links must resolve, MDX must compile, component props must validate, and D2 diagrams must build. No exceptions for "close enough."
- **Glossary integrity, page and section IDs, and API-reference consistency are checked too.** Anchors that go nowhere and terms that drift don't pass.
- **No page ships with an open blocker — not a policy, the build.** Blocker and major findings have to clear before a page is allowed through. There's no override flag that quietly lets slop out.

## The agent that writes isn't the agent that judges

Self-review is how hallucinations get rubber-stamped. So docstube splits the roles. A writer agent drafts the MDX. A reviewer agent — one per reader persona — checks audience fit. A verifier model, from a different family than the writer by default, checks accuracy against the source. The model with a stake in the answer being right is not the model that decides whether it is.

## API tables don't go through a model at all

The most error-prone part of any reference — signatures, parameters, return types — is the part docstube refuses to let an LLM write. API tables are extracted deterministically from your types: TypeDoc for TypeScript and JavaScript, griffe for Python. Change a signature and the table updates from the source, zero tokens spent and no chance of a paraphrased parameter that doesn't match the code.

## It stays checked as the code moves

Verification isn't a one-time launch gate. docstube keeps a tree-sitter codemap with symbol-level provenance, so when you change a function, only the pages that depend on it regenerate — and they re-clear the gate before they're considered current. A drift report surfaces where your existing docs already disagree with the code. The GitHub Action opens a PR with only the changed pages and the reasons; it never pushes silently.

## Why docstube

- **Verified, not hallucinated.** Every factual claim is grounded in your source and machine-checked before it ships.
- **Always-current.** Change a function and only the dependent pages regenerate, then re-clear the same checks.
- **Written for your readers.** Name your personas; a reviewer per persona checks each page for depth and tone.
- **Bring your own AI.** Runs on your existing Claude, Codex, or Gemini subscription, or any compatible API key, with spend caps you set.
- **Open source.** MIT, generates MDX, zero lock-in.

## How it works

1. Point docstube at your repo. A local web UI wizard opens.
2. Choose the doc type, define reader personas, add a little context.
3. A writer agent reads your code; reviewer and verifier agents check it for fit and accuracy; the deterministic checks run.
4. Review the result rendered exactly as it'll look live, and leave feedback on any element.
5. The writer agent refines until you're happy.
6. On every code change, only the affected pages regenerate — and re-clear the gate.

The wizard asks the minimum, then runs on its own. You review where you want to; the gate covers what you don't.

## Use your existing subscription

docstube runs on the coding agent you already pay for — the official Claude, Codex, or Gemini CLIs — or a direct-API adapter for any OpenAI- or Anthropic-compatible endpoint, so open-weight and self-hosted models fit as a config matter. It estimates vendor usage and freezes at the cap you set, with margin; runs are resumable.

Your source context goes only to the AI provider you already use, on your own credentials — never to docstube's servers.

## You own the output

The result is a self-contained Astro + React site, vendored into your repo with no runtime dependency on docstube. Eject it, theme it, host it anywhere. MIT-licensed, no lock-in.

## FAQ

**If agents write everything, how do I know it's not making things up?** You don't take the model's word for it. Code samples compile, imports resolve against your real package, links and diagrams are machine-checked, and a different model family reviews the result. Anything that fails is a blocker, and blockers don't ship.

**Can I override a failing check to get a page out faster?** The gate is the build, not a suggestion. A page with an open blocker stays unpublished — that's the property that makes the rest safe.

**Doesn't a second AI just hallucinate differently?** The verifier isn't the last line — the deterministic checks are. `tsc`, `pyright`, import resolution, and link checking don't have opinions. The cross-vendor review catches what those can't, like audience fit and subtle misstatements.

**Which languages get full verification?** Any codebase works. TS/JS and Python are tier-1, with full deterministic verification and API extraction.

## Final CTA

**Headline —** Don't trust the writer. Trust the check.

**CTA —** `npx docstube wizard`

**Microcopy —** MIT-licensed. Runs on your own AI. No page ships with an open blocker.
