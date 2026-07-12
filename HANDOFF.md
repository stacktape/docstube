# HANDOFF — from product planning to architecture & implementation

**Context:** PRODUCT.md was rewritten from the ground up in a July 2026 planning session (claude.ai, with three deep-research passes). It supersedes the previous plan entirely.

## Repo placement

```
docstube/
├── PRODUCT.md              ← the new source of truth (this session's output)
├── HANDOFF.md              ← this file (delete after architecture step)
└── knowledge/
    └── research/
        ├── 01-competitor-feature-mining.md
        ├── 02-segment-strategy.md
        └── 03-l4-feature-plan.md   ← save the three research artifacts here
```

## Critical warning for the next session

**An older implementation exists in this repo, built against the OLD PRODUCT.md by a less capable model.** Do not treat it as the foundation.

Architecture step must begin with a salvage inventory: for each existing app/package, decide keep / adapt / rewrite — judged against the NEW contracts (entity model §3.1, plugin kernel §3.4, provenance §3.2, autonomy defaults §3.3). Expect the entity model and plugin kernel to invalidate significant portions; that's fine and anticipated.

First data point (reviewed 2026-07): the CLI entry (`citty`-based, lazy per-command imports, telemetry wrapper with disclosure) is a likely **adapt** — add `audit` + `plugin` commands and derive `check` kinds from registered verifier plugins instead of the hardcoded `d2|mdx|snippet|config` union.

## Process from here

1. **Architecture** (Cowork, repo local): salvage inventory → monorepo structure (founder will provide current apps/packages layout + tech stack) → design docs for the open questions in PRODUCT.md §7 → package-level architecture with the §3 contracts as fixed points.
2. **Acceptance criteria**: per-package `ACCEPTANCE.md`. Recommended harness: a **golden fixture repo with planted defects** docstube must catch (the natural end-to-end test for a verification product), plus unit tests for each verifier (known-defect fixtures), Playwright for the web UI, record/replay for agent calls in CI.
3. **Implementation**: Claude Code (Fable 5), package by package, judged against ACCEPTANCE.md.

## Non-negotiables to preserve (see PRODUCT.md for full spec)

- Auto-merge by default; flags = exceptions, not supervision (L4 posture, §3.3)
- Entity model is the universal schema — provenance, guarantees, feedback, regeneration all key off it (§3.1)
- First-party features go through the plugin API (§3.4)
- BYO-AI privacy: docstube servers never see source/prompts/docs (§3.6)
- Never claim "zero hallucinations" — always "flagged, never silently wrong"
