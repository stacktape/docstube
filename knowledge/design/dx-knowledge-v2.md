> Folded into PRODUCT.md / ARCHITECTURE.md on 2026-07-21; this file remains the decision record.

# DX & knowledge v2 — founder decisions (2026-07-21)

Source: Sol xhigh design review domains 08 (config & DX) and 09 (knowledge & feedback),
adjudicated by the founder. Binding for 0.1.0 alongside the other *-v2 design docs.

## First-run & config decisions

1. **Bare `docstube` is context-aware.** No config → opens the browser directly into first-run
   setup; config present → opens the dashboard. TTY-safe: non-interactive shells print the URL
   instead; `--no-open` always available. The wizard's broken bootstrap (dashboard-first routing,
   AI steps circular before config exists, generation without site emission) is replaced by
   Sol's onboarding-session model: an autosaved draft that works BEFORE committed config exists,
   agent-backed setup steps accept the draft directly, and "Generate" atomically preflights,
   commits config, runs the pipeline, emits the site, and lands on the live preview. Wizard
   collapses to four adaptive phases (Scope → Agent & budget → Docs plan → Generate/preview);
   components/versions/tokens/role-models move behind progressive disclosure.

2. **Provider setup: preselect the sole detected provider.** Detection finds installed CLIs and
   credential env vars; exactly one viable provider → preselected with visible rationale
   ("Claude CLI — installed, logged in") plus a tiny live preflight call so auth failures
   surface in setup, not mid-run. Multiple viable providers → explicit choice with comparison;
   docstube never silently ranks one subscription/API over another.

3. **Spend communication: the estimate IS the Generate button.** The button shows the work plan
   (pages × tasks × locales × retries) and the cap in transport-appropriate units — dollars for
   API billing, PLAN-WINDOW PERCENTAGE for subscription CLIs, tokens/time for local models.
   First click = approval; later runs are governed by the cap without re-asking. Founder
   emphasis: the wording must be genuinely understandable for prepaid-plan users — this copy
   gets first-class UX attention, and dollar figures never appear when a plan signal exists.

4. **docType becomes a PRESET LAYER, not a control layer** (founder's synthesis). The enum
   expands to a richer archetype set that covers real repos (library, cli-tool, framework,
   saas-product, self-hosted-app, api-service, internal-tooling, monorepo-mixed — final list at
   implementation) with smarter multi-signal detection (exports, bin entries, frameworks,
   README shape, publish state — never just repo privacy). The archetype fills DEFAULTS for the
   fields that actually drive behavior — `visibility` (public|internal docs), `productKind`,
   `coverage`, suggested personas — and each is an explicit, overridable config field. The
   pipeline branches only on the explicit fields; docType remains the one-word shorthand for
   prompts and UX. The wizard shows the inference with evidence and explicitly asks the one
   thing code can't reveal: "are the docs public?" (kills the private-repo→internal-docs
   misclassification; most commercial repos are private with public docs).

## Knowledge & feedback decisions

5. **GitHub is an actionable answer surface.** The Action posts open tribal questions as a
   comment thread; replies from users with repo write access, using an explicit `/answer`
   convention, are ingested as attributed answers on the next Action run (pull-based — no
   webhooks or bot infrastructure). CLI and local UI answering remain. The convention guards
   against canonizing casual musings.

6. **Tribal knowledge gets durable semantic identity: KnowledgeNeed + KnowledgeFact contracts.**
   Replaces question-text-hash files (whose traced failures: cross-subject merges via paraphrase
   dedup, indefinite silent suppression of new questions, answer overwrites with no history, and
   answers that never go stale). Needs and Facts are records with stable IDs, authorship,
   status, and supersession. Dedup key = subject + kind-of-missing-fact (slots); text similarity
   only SUGGESTS merges in the queue, never silently discards. Facts bind to code two ways: the
   durable entity thread (trust-model-v2 identity threading — survives refactors, no re-ask)
   plus the answer-time revision fingerprint (material change → `needs-revalidation`: pages
   flagged, ONE targeted re-ask). Committed knowledge becomes a public data format at release —
   this ships before 0.1.0 or the migration becomes an adopters-wide break.

7. **Auto-answer agent (founder-initiated).** Before any human is interrupted, a researcher-role
   agent with its own harness attempts the answer: deeper code research plus web search when the
   subject is external (platform limits, third-party behavior). Rules: AI-produced facts carry
   `origin: ai` and MUST cite evidence (source URL or code refs) — rendered as cited external
   facts, never "maintainer-attested"; an uncited confident answer counts as failure and
   escalates. Needs are classified external-world / derivable (auto-answerable) vs intent-policy
   (human-only — AI never invents project intent). Escalated questions carry the auto-answerer's
   research so humans answer faster. Own budget partition; web search only on transports that
   support it; external facts also flip to needs-revalidation (revalidated when citing pages
   regenerate — no crawler in v1). Flagged design-carefully.

8. **Answers/feedback causally invalidate their pages** (mechanism for release-scope-v2's
   immediate-targeted-regeneration): every generation unit records IDs+hashes of consumed
   knowledge facts, instructions, criteria, glossary entries, and config/IA fragments; changing
   any marks exactly the dependent units dirty. Answers move `answered → propagation-pending →
   applied` with visible status ("answer saved; 2 pages regenerating"). Broad-scope changes
   produce an explicit budgeted backlog, never silent waiting.

9. **Feedback storage is governed.** Immutable FeedbackEvent records first; categorization emits
   typed, scoped proposals (intent, scope, affected consumers, canonical wording, confidence)
   that may route to MULTIPLE consumers (a rule like "install guides need rollback steps" feeds
   BOTH writer instructions and review criteria). Entity/page scope by default, applied
   immediately; project-wide promotion is an explicit user choice (per release-scope-v2). Bug
   fixes bundled: learned criteria COMPOSE with built-ins (today they replace them); glossary
   feedback writes through the typed glossary.yaml editor instead of a dead-end note file.

10. **Config-category feedback ships in 0.1.0 as a validated YAML patch preview** via the
    comment-preserving Document API, shown as a diff with one-click apply. Config is the user's
    hand-owned file, so the click survives the minimal-review tenet; no auto-apply.

## Sequencing

Items 6–8 join the claim-ledger/state migration (knowledge records reference entity threads and
fingerprints from the same contracts). Items 1–4 are the wizard/CLI rebuild and land with the
generate-reconciler (the atomic Generate step IS the reconciler). Item 5 lands with the Action's
PR-summary work. Item 7 follows item 6's contracts and may ship its web-search capability
incrementally per transport.
