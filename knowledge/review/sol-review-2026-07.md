# GPT-5.6 Sol second-opinion review — outcome record (2026-07-17)

A 27-chunk adversarial review of the whole codebase by GPT-5.6 Sol (codex subscription), each
finding verified against the tree by a triage pass, confirmed items fixed in two batches.
Raw chunk reports lived in session scratch; this file is the durable distillation.

## Numbers

- 27 module chunks reviewed; ~110 findings total.
- Chunks 1–9: 17 fix-now (all fixed), 3 design concerns adopted (reviewer tool access,
  run-failure journaling, proven-docstring reconciliation), several refuted.
- Chunks 10–27: 80 findings — 61 confirmed (16 fix-now, all fixed; 27 fix-later; 18 wontfix-v1),
  12 design-choice (intent already recorded in code/docs), 1 refuted.

## Fix-later backlog (confirmed real, deliberately deferred)

i18n cluster (see design concern 1): translations excluded from site-scope verify; refresh and
refine never retranslate changed pages; translate retries don't thread prior findings; locale nav
lists untranslated pages; removed locales never pruned.

Pipeline/state: configHash/iaHash stored but never compared (criteria/instruction/glossary edits
don't invalidate pages); entity-less site findings dropped + index systemFlags hardcoded [];
unanchored-verifier-failure cannot revoke another prover's proven (only on already-flagged pages);
version-cut skips missing shards silently; frozen snapshots lack their own index; manifest writes
non-atomic; feedback categories missing 'config'; propose-ia allows duplicate proposal ids;
decodeURIComponent 500 on /%ZZ.

Harness/transports: transport capabilities declared but never enforced; structured-output
pre-validator ignores $ref/minLength/additionalProperties (Zod re-parse downstream catches it as
warning); grep reads whole file before size check; unbounded vendor stdout accumulation;
forwarded-tools temp-dir leak on mkdtemp throw; no fetch deadline on HTTP transports; ESM-only
plugin packages unresolvable via require.resolve.

Language packs: TS export-alias symbols recorded under local name; snippet typecheck strict:false
and ignores repo tsconfig; "any package.json ⇒ TypeScript" detection; python chained assignments
share one hash + tuple destructuring dropped; pkg-snapshot python inspector temp path executed
without hash validation.

Verifiers/theme: D2 edges never grounded (blocked: Codemap has no relations concept — PRODUCT
§4.1 wants edge grounding); duplicate identical fences collapse to first fence's meta; relative
links + query strings falsely dead in internal-links; sh fences run under bash; malformed
shellcheck output reads as clean (mitigated by proves:false); no Astro base support (subpath
deploys); stale emitted files never removed; plugin-registered components never vendored into the
emitted site (ComponentDefinition.source exists for exactly this); source-MDX read failure
silently omits a page from the site; answer command's full-flag-id form never matches.

UI/Action: wizard can't clear logo/favicon in edit mode; locale duplicates accepted; git
porcelain parsed without -z; plugin-sdk brand-only guard yields raw TypeError.

## Wontfix-v1 (theoretical under the founder's UX-first stance)

Localhost single-user write races; non-atomic plugin registration; context-file symlink escape
(owner's own repo); cache-key traversal (keys always internal sha256); MCP protocol-version echo;
declaration-only library extraction; shallow manifest freeze (plugins are in-process anyway).

## Design concerns adopted as future work

1. **i18n needs one design pass, not eight spot fixes** — the whole translation lifecycle
   (verify scope, refresh/refine retranslation, retry findings, nav, pruning) was bolted onto
   generate only. Largest coherent cluster of the review.
2. **The harness owns cache freshness now** (fixed via observed-read revalidation on cache hit);
   the contextHashes caller seam remains as an additional input, not the sole guard.
3. **TS symbol hashes include implementation bodies** — every private body edit regenerates
   dependent pages. lang-python already hashes signature-shape only; lang-typescript should
   likely match. Cost lever on real repos; founder call pending.
4. **wizard-state hand-mirrors contracts** — already caused one real divergence (theme/site
   logo). Share the schema instead of transcribing it.

## Doc drift (specs promise what code deliberately doesn't do yet)

- ARCHITECTURE §7 + PRODUCT §3.5: TypeDoc/griffe `apiTruth` promised; extraction is deliberately
  syntactic and `apiTruth` is never populated.
- PRODUCT §3.9.4: feedback routes into criteria/instructions/glossary/config — code ships three
  of four (no 'config' category).
- PRODUCT §4.1: D2 nodes AND edges grounded — Codemap has no relations model.
- ARCH §8.1/§8.2: uniform structured-output repair + enforced capability degradation — session
  transports skip repair (deliberate), capabilities never enforced.
- ARCH §2/§3.4: plugin theme components as v1 contract — emit-site only vendors built-ins.
