<!--
Variant 14 — "Fast — and it won't torch your token budget."
Lead angle: The fast & token-efficient pillar, developed from the founder TBD. Four concrete mechanisms carry it: content-addressed caching (reuses work on retry/resume), depth-first scheduling (a reviewable page in minutes), incremental regeneration (only affected pages), and spend caps (estimate, freeze at cap, resume). Verification is present but framed as "the gate doesn't cost extra tokens" where true (deterministic checks, extracted API tables).
Tone: Performance-minded, pragmatic, engineer-to-engineer. Mechanisms over marketing. No invented benchmarks, no fabricated numbers.
Primary persona: Rate-limit- and cost-aware developers who've watched an agent burn a subscription on a retry loop.
Why it might win: It speaks to a real, felt pain — the unbounded-spend fear — and answers it with caps and caching, not vibes.
Biggest risk: Promising speed implies numbers; must stay mechanism-only and never imply autonomy means unchecked output.
-->

## Hero

**H1 —** Fast — and it won't torch your token budget.

**Sub —** docstube reuses work it's already done, schedules so you see a real page in minutes, regenerates only the pages a change touches, and freezes at the spend cap you set. The agents write the whole site and verify it — without burning a subscription on a retry loop. Open source, and it runs on the AI you already pay for.

**Primary CTA —** Run the wizard: `npx docstube wizard`

**Secondary CTA —** See how it stays efficient

**Hero visual —** A spend meter, not a speedometer. A horizontal budget bar with a clearly marked cap line and a margin buffer before it; a label reads "estimated · capped · resumable." Below it, a small build timeline showing one page going green ("first reviewable page") well before the rest, and a row of cache-hit ticks on a re-run labeled "reused, 0 tokens."

## Spend you decide up front

The fear with autonomous agents is a runaway bill. docstube removes it by design. Before a run, it estimates the vendor usage the job will take. During the run, it watches consumption and freezes when you approach the cap you set — with margin, so it stops before it overshoots, not after. A frozen run is resumable: raise the cap or pick it up later, and it continues from where it stopped instead of starting over.

You set the ceiling. docstube respects it. There's no scenario where it quietly keeps spending past the number you gave it.

## It doesn't pay twice for the same work

docstube is content-addressed: work is keyed by the normalized hash of its inputs. If an input hasn't changed, the result is reused instead of regenerated. That matters most exactly when naive tooling is most wasteful:

- **On a retry,** the pages that already passed aren't redrafted — only the failed work re-runs.
- **On a resume,** a run that froze at the cap picks up the unfinished pages and reuses everything it already produced.
- **On a small edit,** unchanged pages are served from cache, not rebuilt.

The tokens you spend go toward work that actually changed.

## A page you can read in minutes, not a wall at the end

docstube schedules depth-first, so a complete, reviewable page lands early instead of making you wait for the entire site to finish before you see anything. You get something real to react to — rendered exactly as it'll look live — while the rest generates. If the persona's off or the depth is wrong, you catch it on page one and steer, instead of discovering it across fifty pages you already paid to write.

## Change one function, regenerate one set of pages

docstube keeps a tree-sitter codemap with symbol-level provenance via normalized hashes. When your code changes, it knows which pages actually depend on what changed and regenerates only those — not the whole site. Change a function and only the dependent pages rebuild; the GitHub Action PRs exactly that diff with the reasons, and never pushes silently. Keeping docs current costs the price of the delta, not a full re-run every time.

## Efficient because of the gate, not in spite of it

Verification doesn't mean a second pass that doubles your bill. The expensive-to-get-wrong parts are the cheap-to-check parts:

- **API tables are pulled from your types, not written by an LLM** — TypeDoc for TS/JS, griffe for Python. Signatures change, tables update, zero tokens.
- **The deterministic checks don't spend tokens at all.** MDX compilation, `tsc`, `pyright`, import resolution, link checking, and D2 compiling are machine work, not model calls.
- **Cross-vendor review runs once on the draft,** then the build decides. No page ships with an open blocker — not a policy, the build — and that's enforced without a runaway review loop.

## Why docstube

- **Fast & token-efficient.** Content-addressed caching, depth-first scheduling, and incremental regeneration mean you pay for what changed.
- **Bring your own AI.** Runs on your existing Claude, Codex, or Gemini subscription, or any compatible API key — with the spend caps above.
- **Verified, not hallucinated.** Every factual claim is grounded in your source and machine-checked before it ships.
- **Always-current.** Change a function and only the affected pages regenerate.
- **Open source.** MIT, generates MDX, zero lock-in.

## How it works

1. Point docstube at your repo. A local web UI wizard opens.
2. Choose the doc type, define reader personas, add a little context — and set your spend cap.
3. A writer agent reads your code; reviewer and verifier agents check fit and accuracy; deterministic checks run.
4. A reviewable page lands early; review it rendered live and leave feedback on any element.
5. The writer agent refines until you're happy.
6. On every code change, only the affected pages regenerate.

The wizard asks the minimum, then runs on its own — inside the budget you gave it.

## Use your existing subscription

docstube runs on the coding agent you already pay for — the official Claude, Codex, or Gemini CLIs — or a direct-API adapter for any OpenAI- or Anthropic-compatible endpoint, so open-weight and self-hosted models fit as a config matter. It estimates vendor usage and freezes at the cap you set, with margin; runs are resumable, so spend never gets away from you.

Your source context goes only to the AI provider you already use, on your own credentials — never to docstube's servers.

## You own the output

The result is a self-contained Astro + React site, vendored into your repo with no runtime dependency on docstube. Eject it, theme it, host it anywhere. MIT-licensed, no lock-in.

## FAQ

**Can an autonomous run blow my budget?** No. It estimates usage up front, freezes with margin at the cap you set, and resumes from where it stopped. You choose the ceiling.

**If a run fails halfway, do I pay to redo all of it?** No. Work is content-addressed, so retries and resumes reuse everything that already passed and only re-run what didn't.

**Does verification double my token spend?** The deterministic checks and the extracted API tables cost no tokens. Cross-vendor review runs once on the draft; the build does the enforcing.

**How fast is it, exactly?** It depends on your codebase, the agent you pick, and your cap, so we won't quote a number. What we will say: depth-first scheduling gets a reviewable page to you early, and incremental regeneration keeps updates cheap.

## Final CTA

**Headline —** Generate the whole site. Pay for what changed.

**CTA —** `npx docstube wizard`

**Microcopy —** MIT-licensed. Runs on your own AI. Estimates, caps, and resumes — spend stays yours.
