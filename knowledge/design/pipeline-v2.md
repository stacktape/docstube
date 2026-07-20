# Pipeline v2 — founder decisions (2026-07-19)

Source: Sol xhigh design review domains 04 (verification design) and 05 (pipeline & incremental),
adjudicated by the founder. Binding for 0.1.0 alongside trust-model-v2.md and i18n-lifecycle-v2.md.

## Decisions

1. **One command: `docstube generate` is an idempotent reconciler.** Every invocation computes
   desired vs published state and does the minimal work: first run = full generation; later runs
   = affected set; interrupted/frozen runs continue automatically from staged work (no --continue
   flag — continuation is the contract, terraform-apply style). `refresh` is REMOVED outright
   (nothing is released; no deprecation aliases). `audit` stays separate. The wizard's final step
   and the GitHub Action both just run generate.

2. **`refine` keeps its name, gains guardrails.** It remains the "make the worst pages better"
   intent: ranked by open findings, then persona-fit score (derived from recorded per-criterion
   outcomes), then staleness. A reroll is ACCEPTED ONLY if strictly better (fewer findings,
   higher fit) — otherwise discarded. Never makes a page worse; still able to improve pages
   without concrete findings.

3. **Budget freeze = staged, atomic publish.** When a run freezes (cost cap or plan-usage cap),
   completed work is persisted internally (journal + cache; nothing re-billed on resume) but
   NOTHING publishes until the whole plan completes — the site never shows a half-applied
   source change. The next `generate` resumes and publishes atomically. This supersedes the
   previous publish-as-completed freeze behavior.

4. **Invalidation: the combined design.**
   - Detection — typed fingerprint ladder: language packs emit signature / cited-value / body
     fingerprints per symbol; ledger claims subscribe to the kind they depend on (shape claims →
     signature; value claims → the specific value; body subscriptions rare). Files no pack can
     parse (package.json, poms, README…) fall back to whole-file content hashing — the ladder is
     never less safe than today, precision improves per file type. .d.ts files parse as pure
     signatures. TypeScript gains the signature/value/body separation (Python is already
     signature-shaped).
   - Repair — diff-aware minimal edits: an invalidated page gets an edit task (prior page +
     relevant code diff + the stale claims) instead of full regeneration; extends the existing
     retry prior-draft pattern. Benefits: large cost reduction and page wording stability.
   - Escalation — full regeneration when the edit fails verification or structure changed.

5. **Runtime proof posture: execution counts, environment recorded.** Host snippet execution
   keeps conferring checked status; the evidence records the environment fingerprint (OS,
   runtime versions, sandbox: none). Sandboxed evidence supersedes when the OS sandbox ships
   (post-0.1.0 per the harness research decision).

6. **Diagrams narrowed for 0.1.0:** verified = syntax + node names checked against the codemap,
   stated exactly that way; edge grounding waits for the relations graph (v1.x with predicate
   verifiers).

7. **Cross-page consistency redefined by the founder** (supersedes the claim-contradiction
   framing): the real feature is STRUCTURAL QUALITY FAILURE MODES — within-page (two sections
   covering the same topic, examples in the wrong section) and across sibling pages/navigation
   (founder's example: 5 of 8 "compute resources" pages have a Pricing section, 3 don't). Pages
   AND navigation sections have failure modes; not lie-grade, but quality a human would spot.
   Queued as a dedicated Sol design domain; designed properly, not decided in passing.

## Provisional stances (minimal-human-review tenet; founder may veto)

- ia.yml edits are authoritative locally (no confirmation step); CI structural changes remain a
  blocking-review flag kind as already decided.
- Third-party verifier evidence is labeled project-defined and does not mint the built-in badge
  unless explicitly promoted in config (matches trust-model-v2 provisional).
- `no-checker-available` claims do not block auto-merge; they surface as a coverage disposition.
- Release economics SLO (to validate before 0.1.0, numbers provisional): on the dogfood repo, a
  typical single-symbol commit regenerates ≤ 5% of pages p50 / ≤ 15% p90 once typed fingerprints
  land; a body-only refactor regenerates 0.

## Sequencing

Typed fingerprints + diff-edit repair join the claim-ledger rework (the subscription field lives
in the ledger schema). The generate-reconciler + staged-publish changes restructure
generate/maintain around the localization scheduler from i18n-lifecycle-v2. One coherent 0.1.0
program.
