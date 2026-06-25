# docstube — Pitch Deck Spec (5 Variants)

*Vision / narrative artifact. Pre-product, not actively raising — investor-shaped with a soft, optional ask. Every figure traces to the approved fact bank; soft/estimated sources are flagged in speaker notes. No founder or prior-company references anywhere. No fabricated traction. No financial projections. No absolute guarantees ("flagged, never silently wrong," not "zero hallucinations").*

---

## Shared building blocks (used across all variants)

**The four pillars:** verified, not hallucinated · always current · written for your readers · bring your own AI.

**The verifier cascade (product visual):** `samples compile ✓ · imports resolve ✓ · links work ✓ · API refs match ✓ · 1 page flagged ⚠`

**The loop:** structural repo map → writer agent drafts from source → per-persona reviewer agents → deterministic verifiers → retry or ship *flagged for human review* → owned Astro/MDX site → on code change, regenerate only affected pages via symbol-level provenance.

**The 2×2 quadrant:** x-axis *Passive (hosts docs you write) → Active (generates from code)*; y-axis *Unverified → Verified (mechanically checked)*. **docstube alone top-right.** Mintlify / GitBook / ReadMe → passive-unverified. DeepWiki / DocuWriter / Penify → active-unverified. Swimm → passive-verified.

**Approved fact bank (attribute inline; flags = source confidence):**

- AI writes ~20–30% of code at Microsoft (Satya Nadella, LlamaCon, Apr 29 2025); >30% of new code at Google (Sundar Pichai, Q1 2025 earnings); Microsoft CTO Kevin Scott predicts ~95% by 2030; Cognition reports 89% of its own production code committed by its agent Devin (2026, company-reported).
- GitHub Octoverse 2025: 180M+ developers; 630M total repos (395M public, +19% YoY); ~1B commits in 2025 (+25% YoY); ~230 new repos/minute; 1.13M+ public repos import an LLM SDK.
- Stack Overflow 2025 Developer Survey: 84% use/plan to use AI tools; trust in accuracy fell to ~29% (−11 pts); 46% distrust vs. 33% trust; ~3% "highly trust"; 66% frustrated by "AI solutions that are almost right, but not quite"; 45% find debugging AI code more time-consuming.
- Docs are the most-used learning resource (84%, 2024 SO survey; 90% of those use API/SDK docs); ~61–63% of developers spend 30+ min/day searching for answers; a 50-person team loses ~333–651 hrs/week (Stack Overflow). Landmark/dated: Stripe "Developer Coefficient" (2018) — ~17 hrs/week on maintenance, ~$300B/yr lost productivity.
- AI code tools market ~$9.35B (2026) → ~$30B (2031), ~26% CAGR (Mordor Intelligence, 2026 — analyst estimate); Grand View Research ~27% CAGR to ~$26B by 2030. Software documentation tools ~$8B by 2025 (LOW confidence — color only). Population: 180M+ developers; ~30–35M professional developers (industry estimates); 395M public repos + tens of millions of private repos.
- Comparable rounds (reported/estimated): Mintlify — $45M Series B at a $500M valuation (Apr 2026), ~$10M ARR end-2025 (Sacra estimate), 20,000+ companies. Cognition/DeepWiki — $1B+ raised at a $26B valuation (May 2026), ~$492M ARR (company-reported), DeepWiki indexed 50,000+ repos. Postman acquired Fern (Jan 2026, undisclosed). Anthropic acquired Stainless (~May 2026, reported $300M+ by The Information). Open-core comps: Supabase ~$5B valuation, ~$70M ARR; PostHog ~$1.4B valuation, ~$57.5M ARR.

**Business model (3 tiers):** Open-source (free forever, every feature, BYO AI — adoption engine) → Cloud (usage-based; cross-project RAG "Ask agent" + MCP, governance, audit log, analytics, guardrails, collaboration) → Enterprise (custom/fixed; self-host + SLA + onboarding). Suggested mechanic: banded per-site base + seat/usage hybrid. Mirrors the Supabase / PostHog open-core motion.

---
---

# Variant A — "Docs that compile"

> **Rationale:** Verification-first bet, precise + confident tone, for technical/infra investors and engineering-led buyers. Leads the entire deck on trust; the why-now (trust collapse) and how-verification-works slides carry the most weight. *If it can't be checked, it doesn't ship silently.*

**Visual system:** Light background (`#f8fafc` / white). Terminal/compiler aesthetic — monospace accents, green check / amber flag glyphs, a "build: passing" badge language. Teal (`#0097A1`) primary, verification-green and warning-amber as functional accents. Key message top-left of every slide.

---

**Slide 1 — Title**
- Headline: **docstube**
- Subhead: *Docs that compile.* Documentation generated from your code — and mechanically proven against it.
- Visual: docstube lockup centered; below it a single mono line: `$ docstube build  →  ✓ verified · ⚠ 1 flagged · 0 silently wrong`. Generous whitespace.
- Speaker notes: One-line positioning. We're not "AI that writes docs" — we're the verification layer. Set the confident, precise tone immediately. (No traction to show — this is a vision artifact.)

**Slide 2 — Problem**
- Headline: **Docs rot the moment they're written. AI made it worse.**
- Body: (1) Every commit pushes the docs further out of date. (2) Generic AI doc writers produce fluent prose untethered from the code — confident, well-formatted, and wrong in ways you can't see. (3) The result devs already cite about AI: "almost right, but not quite."
- Visual: split panel — left, a doc paragraph with a subtly stale API signature highlighted amber; right, the actual current source signature. The mismatch is the story.
- Speaker notes: Frame the failure mode precisely. The danger isn't obviously-broken docs — it's plausibly-wrong docs that read fine. That's what verification targets.

**Slide 3 — Why now (the killer slide)**
- Headline: **Code volume is exploding. Trust is collapsing. The gap is verification.**
- Body (dual stat block):
  - *Volume up:* AI writes ~20–30% of code at Microsoft (Nadella, LlamaCon Apr 2025) and >30% of new code at Google (Pichai, Q1 2025); Kevin Scott predicts ~95% by 2030. GitHub Octoverse 2025: 180M+ developers, ~1B commits in 2025 (+25% YoY).
  - *Trust down:* Stack Overflow 2025 — 84% use AI tools, but trust in accuracy fell to ~29% (−11 pts); 46% distrust vs. 33% trust; 66% frustrated by "almost right, but not quite."
- Visual: the signature dual chart — a rising AI-generated-code-volume line crossing a falling trust line. The crossing is labeled "the verification gap."
- Speaker notes: This is the strongest, best-sourced slide — let it land. SO 2025 is the backbone. Note in the room that the bottleneck has moved from *writing* code to *trusting/reviewing* it. (All figures from the fact bank; SO survey is solid, Scott's 2030 number is a prediction.)

**Slide 4 — Solution**
- Headline: **Not AI that writes your docs. Docs mechanically checked against your code.**
- Body: docstube is an open-source CLI that reads a codebase and generates verified, always-current, audience-targeted docs — running on your own AI, outputting a docs site you own. Pillars: verified · always current · written for your readers · bring your own AI.
- Visual: the word "verified" set large with a green check; the other three pillars as supporting mono chips.
- Speaker notes: The shift in one sentence. "Verified, not hallucinated" is the spearhead — it's genuinely unclaimed by funded competitors. Avoid "zero hallucinations"; we say "flagged, never silently wrong."

**Slide 5 — Product / how it works**
- Headline: **Write → review → verify → ship. Nothing ships silently wrong.**
- Body: the loop, shown not told. Writer agent drafts from source → per-persona reviewer agents → deterministic verifiers → retry with feedback or ship flagged → owned site → regenerate only affected pages on change.
- Visual: clean left-to-right loop diagram; beneath it the verifier cascade as a terminal readout: `samples compile ✓ · imports resolve ✓ · links work ✓ · API refs match ✓ · 1 page flagged ⚠`. Inset: a "drift report" card — "your docs disagree with your code in N places."
- Speaker notes: The deterministic gate is what carries the trust load — these are mechanical checks, not a model "score." API refs are extracted from the compiler, never written by an LLM. The drift report is a near-free byproduct and a great launch stunt on a famous OSS project.

**Slide 6 — Why it's different**
- Headline: **The wedge: verification + ownership + bring-your-own-compute.**
- Body: Verified (mechanically checked against source) · Owned (a self-contained Astro/MDX site, no lock-in) · BYO AI (your key or subscription, any model, no token markup, source never uploaded).
- Visual: introduce the 2×2 quadrant; docstube alone top-right (Active × Verified). Keep it teaser-light here; full table on the competition slide.
- Speaker notes: Each piece exists somewhere in isolation; the combination doesn't. The two least-copyable pillars are the deterministic verifier and symbol-level provenance — those are the real defense.

**Slide 7 — Market**
- Headline: **Riding the AI-code-tools market — anchored on developers and repos.**
- Body (building blocks, show the math): TAM — AI code tools ~$9.35B (2026) → ~$30B (2031), ~26% CAGR (Mordor, analyst estimate). SAM — 180M+ developers, 395M public repos + tens of millions of private repos needing internal docs. SOM — bottom-up: repos/sites × per-site pricing, or developers × modest ACV. (Documentation-tools ~$8B figure shown only as color, low confidence.)
- Visual: nested TAM/SAM/SOM circles; soft figures tagged "estimate."
- Speaker notes: Anchor on the code-tools market and GitHub population, not the shaky docs-tools number — flag it as low-confidence color. Bottom-up is more defensible than top-down here.

**Slide 8 — Business model**
- Headline: **Open-core: free CLI for adoption, paid for what one repo can't do.**
- Body: OSS (free forever, every feature, BYO AI) → Cloud (usage-based; cross-project RAG "Ask agent" + MCP, governance, audit log, analytics) → Enterprise (custom; self-host + SLA + onboarding). Suggested: banded per-site base + seat/usage hybrid.
- Visual: 3-tier ascending ladder. Footnote: audit logs are a gap at GitBook/ReadMe — a legitimate paid hook.
- Speaker notes: Mirrors the proven Supabase (~$5B val, ~$70M ARR) / PostHog (~$1.4B val, ~$57.5M ARR) motion — free self-host drives adoption; teams pay for not running infra, cross-project intelligence, and governance. (Comps reported/estimated.)

**Slide 9 — Competition**
- Headline: **Everyone hosts docs or generates prose. Nobody verifies.**
- Body: the quadrant + an honest table. Concede where incumbents lead (Mintlify: capital, distribution, Autopilot incremental updates; DeepWiki: free, MCP-native, $26B backing). docstube's column: mechanical verification + owned output + BYO-compute.
- Visual: 2×2 quadrant (full) beside a feature table — rows: verified · generates from code · owned output · BYO compute · audit log. Honest checks and gaps.
- Speaker notes: Conceding builds credibility. Mintlify — $45M Series B at $500M val (Apr 2026), 20,000+ companies. DeepWiki — reads code → explains it, hosted/browse-only, your code goes to their servers. Keep it factual and fair, no trash-talking.

**Slide 10 — Moat / "won't the model vendors just build this?"**
- Headline: **Why this isn't a weekend feature for a model vendor.**
- Body: deterministic verification (mechanical, not a model score) + self-owned output (no lock-in) + provider-neutral BYO-compute (works across Claude / Codex / Gemini, no token markup) + your source never uploaded to a vendor. Neutrality is the hedge.
- Visual: a shield/layers graphic; "provider-neutral" highlighted as the structural hedge against any single vendor.
- Speaker notes: Answer the vendor question head-on. A model vendor's incentive is to route you to their tokens; ours is to be neutral and never receive your code. That neutrality is exactly what a vendor can't copy without undercutting itself.

**Slide 11 — Team**
- Headline: **Team**
- Body: `[[PLACEHOLDER: team — to be added]]`. Neutral hiring framing only; no names, no histories.
- Visual: minimal placeholder block.
- Speaker notes: Intentionally minimal per current direction. Do not infer or invent bios.

**Slide 12 — Vision**
- Headline: **Verified docs are the infrastructure of the AI-software era.**
- Body: When humans write less of the code and trust the output less, the scarce thing is *verified* explanation. docstube is that layer — built on the AI you already pay for, on a site you own.
- Visual: the verifier cascade fading into a clean owned-docs site; closing line *if it can't be checked, it doesn't ship silently.*
- `[[OPTIONAL — only when raising]]` Ask: `[[PLACEHOLDER: $amount]]` to `[[PLACEHOLDER: use of funds]]`. No projections.
- Speaker notes: Soft close. Optional ask slide only when actually raising — placeholders until then.

---
---

# Variant B — "Your code. Your AI. Your docs."

> **Rationale:** Ownership / anti-lock-in + BYO-compute bet, bold and a little rebellious, for founders and devtools investors who care about platform economics. The enemy is lock-in + token markup; strongest on business-model and "why this spreads" slides.

**Visual system:** Light background, high-contrast, oversized type. Teal (`#0097A1`) with a bold ink-slate (`#0f172a`) for emphasis. Recurring motif: the word "Your" owned/underlined; a broken-padlock / unlock glyph for lock-in. Punchy, few words per slide.

---

**Slide 1 — Title**
- Headline: **Your code. Your AI. Your docs.**
- Subhead: docstube — open-source docs generation that runs on the compute you already pay for, and outputs a site you actually own.
- Visual: three short lines stacked, "Your" highlighted teal each time; docstube lockup beneath.
- Speaker notes: Lead with ownership. Everything else in the deck ladders back to these three words.

**Slide 2 — Problem**
- Headline: **The docs you "own" today live on someone else's platform.**
- Body: (1) Docs rot the instant code changes. (2) Incumbents host your docs, meter your tokens, and lock in your content. (3) Generic AI doc writers add fluent-but-untrustworthy prose on top — you pay a markup for words that aren't checked against your code.
- Visual: a "docs platform" box with a padlock and a meter ticking up; your content trapped inside.
- Speaker notes: Reframe the pain as ownership + economics, not just staleness. The lock-in and the token markup are the felt costs we remove.

**Slide 3 — Why now**
- Headline: **More code than ever, written by AI you already pay for — on terms you don't control.**
- Body: AI writes ~20–30% of code at Microsoft (Nadella, Apr 2025) and >30% at Google (Pichai, Q1 2025); GitHub Octoverse 2025 — 180M+ developers, ~1B commits (+25% YoY), 1.13M+ public repos already import an LLM SDK. Meanwhile Stack Overflow 2025 — trust in AI accuracy fell to ~29% (−11 pts), 46% distrust. Developers already run coding agents (Claude Code, Codex, Gemini CLI); the compute is in their pockets.
- Visual: rising AI-code-volume line vs. falling trust line; an inset "you already pay for this compute" callout pointing at the dev.
- Speaker notes: Two why-nows fused — the macro shift AND the fact that BYO-compute is newly feasible because everyone already has an agent. (Octoverse + SO figures solid; the 2030 prediction omitted here to keep the slide tight.)

**Slide 4 — Solution**
- Headline: **Bring your own AI. Keep your source. Own the output.**
- Body: docstube generates verified, always-current docs on your key or subscription — any model, no token markup, your source never leaves your machine — and ships a self-owned Astro/MDX site. Verified, not hallucinated, is the spearhead.
- Visual: a flow — your repo → your model (Claude / Codex / Gemini icons, neutral) → your owned site. No vendor in the middle.
- Speaker notes: BYO-compute is presented purely as a strength: your compute, any model, no markup, nothing uploaded. (Per direction, we don't dwell on third-party CLI ToS in the deck.)

**Slide 5 — Product / how it works**
- Headline: **A real pipeline, not a prompt — and it runs on your machine.**
- Body: structural map → writer agent → per-persona reviewers → deterministic verifiers → retry or ship flagged → owned site → regenerate only what changed. All on your compute.
- Visual: the loop diagram with a "runs locally / your key" band underneath; verifier cascade `samples compile ✓ · imports resolve ✓ · API refs match ✓ · 1 flagged ⚠`.
- Speaker notes: Emphasize that the productionized pipeline (deterministic gates + symbol-level sync + persona review) is the value over "just prompt Claude myself" — and it never ships your code to us.

**Slide 6 — Why it's different**
- Headline: **No markup. No lock-in. No upload. No black box.**
- Body: the wedge as four refusals — token markup (none), platform lock-in (owned output), source upload (never), opaque AI score (deterministic gates). Quadrant teaser: docstube top-right.
- Visual: four struck-through "nope" chips; the quadrant in the corner.
- Speaker notes: The rebellious framing. Each "no" maps to a real mechanism, not a slogan.

**Slide 7 — Market**
- Headline: **180M+ developers already hold the compute. We're free to start.**
- Body: TAM — AI code tools ~$9.35B (2026) → ~$30B (2031), ~26% CAGR (Mordor, analyst estimate). SAM — 180M+ developers, 395M public repos + tens of millions of private. SOM — repos/sites × per-site, or devs × modest ACV. Zero marginal compute cost to us (the user pays their own LLM bill).
- Visual: nested TAM/SAM/SOM; a callout: "our COGS on generation ≈ $0 — the user brings the compute."
- Speaker notes: The BYO economics are a market-slide advantage: adoption isn't throttled by our token costs. Flag the docs-tools $8B figure as low-confidence color only.

**Slide 8 — Business model**
- Headline: **Free to spread. Paid for what a single repo can't give you.**
- Body: OSS free forever (the spread engine; we never mark up tokens) → Cloud usage-based (cross-project RAG "Ask agent" + MCP across all your projects, governance, audit log, analytics) → Enterprise (self-host + SLA). The paid value is org-level intelligence + governance — which by definition don't exist in one self-hosted repo.
- Visual: 3-tier ladder; the Cloud tier highlighted with "cross-project Ask agent" as the hero hook.
- Speaker notes: This is the strongest slide for B. Supabase/PostHog prove the motion (free self-host → paid hosted + governance). Even when the free tier is ~80% as good for one project, the cross-project + audit value is defensible. (Comps reported/estimated.)

**Slide 9 — Competition**
- Headline: **They host and meter. We hand you the keys.**
- Body: quadrant + honest table. Concede incumbents' distribution and polish; our column is BYO-compute (no markup) + owned output + verification + source-never-uploaded.
- Visual: 2×2 quadrant + table rows: token markup · owns your output? · uploads your source? · verified · audit log.
- Speaker notes: Fair and factual — Mintlify ($500M val, 20,000+ companies) and DeepWiki ($26B backing, 50,000+ repos) are real and good at hosted. We're the opposite model on purpose. No trash-talking.

**Slide 10 — Moat / "won't the model vendors just build this?"**
- Headline: **Provider-neutrality is the moat a vendor can't copy.**
- Body: a model vendor wants you on their tokens; we work across Claude / Codex / Gemini with no markup and never receive your source. Plus deterministic verification + self-owned output. Neutrality is the structural hedge.
- Visual: a switch labeled "swap models anytime"; vendor logos neutral and interchangeable behind it.
- Speaker notes: A vendor copying us would have to give up token margin and lock-in — the two things they're built on. That's our durable edge.

**Slide 11 — Team**
- Headline: **Team**
- Body: `[[PLACEHOLDER: team — to be added]]`. Neutral hiring framing; no names or histories.
- Visual: minimal placeholder.
- Speaker notes: Intentionally minimal per current direction.

**Slide 12 — Vision**
- Headline: **The docs layer should belong to the people who write the code.**
- Body: own your compute, own your output, own your docs — verified against your source, current with every commit. That's the default we're building toward.
- Visual: three "Your" lines resolving into one owned site; closing wordmark.
- `[[OPTIONAL — only when raising]]` Ask: `[[PLACEHOLDER: $amount]]` → `[[PLACEHOLDER: use of funds]]`. No projections.
- Speaker notes: Soft close on ownership. Optional ask only when raising.

---
---

# Variant C — "The trust layer for AI-written code"

> **Rationale:** Docs-as-AI-infrastructure bet, visionary + credible, for thesis-driven / category-creating investors. Opens hard on the macro shift and closes big. Heavy on why-now and the "documentation is infrastructure for agents" (llms.txt / MCP) thesis.

**Visual system:** Light background, spacious, layered "infrastructure stack" aesthetic. Deep teal gradients (`#7ED0BE → #36A6A4 → #0A7B85`) on white; refined, editorial. Fewer glyphs, bigger ideas. Section dividers framed as stack layers.

---

**Slide 1 — Title**
- Headline: **The trust layer for AI-written code.**
- Subhead: docstube — documentation generated from your code and mechanically verified against it, for a world where machines write most of the software.
- Visual: a layered stack graphic with "verified docs" as the named layer between "code" and "humans + agents"; docstube lockup.
- Speaker notes: Position as category infrastructure from word one. This variant is the most "new category" of the five.

**Slide 2 — Problem**
- Headline: **When AI writes the code, who verifies what it means?**
- Body: (1) Docs rot the instant code changes — and code now changes faster than ever. (2) Generic AI doc writers generate fluent prose untethered from source. (3) Worse: docs are increasingly read by *agents*, not just people — and an agent acting on wrong docs fails silently and at scale.
- Visual: a human and an agent both reading the same docs; the agent's wrong action cascading.
- Speaker notes: Elevate the problem from "humans waste time" to "the entire AI-software stack needs a verified knowledge layer." That's the category claim.

**Slide 3 — Why now (the killer slide, weighted heaviest)**
- Headline: **Humans write less of the code and trust the output less. Verification is the scarce thing.**
- Body:
  - *The machines are writing it:* ~20–30% of code at Microsoft (Nadella, LlamaCon Apr 2025), >30% of new code at Google (Pichai, Q1 2025), ~95% predicted by 2030 (Kevin Scott); Cognition reports 89% of its own production code committed by its agent (2026, company-reported). GitHub Octoverse 2025 — 180M+ developers, 630M repos, ~1B commits (+25% YoY).
  - *And nobody trusts it:* Stack Overflow 2025 — 84% use AI, but trust fell to ~29% (−11 pts), 46% distrust, 66% frustrated by "almost right, but not quite."
- Visual: the dual chart — exploding AI-code volume vs. collapsing trust; the widening gap labeled "the verification layer."
- Speaker notes: Make this land — it's the thesis. The bottleneck moved from writing to trusting. Note the 2030 and Cognition figures are predictions/company-reported; the SO and Octoverse data are solid.

**Slide 4 — Solution**
- Headline: **Docs proven against the source — and legible to agents by default.**
- Body: docstube reads the repo, drafts on your own AI, and mechanically verifies every page against the code; ships an owned site **plus** `llms.txt` + a docs-serving MCP server so agents consume verified docs, not guesses. Pillars: verified · always current · written for your readers (human and machine) · BYO AI.
- Visual: one content store → two render targets: a human site and an AI/MCP endpoint.
- Speaker notes: The agent-readability angle is unique to C. Verified API refs are extracted from the compiler, never written by an LLM — exactly what an agent needs to trust.

**Slide 5 — Product / how it works**
- Headline: **A generate-and-verify pipeline that produces infrastructure, not just pages.**
- Body: structural map → writer → per-persona reviewers → deterministic verifiers → retry or ship flagged → owned site + `llms.txt` + MCP → regenerate only affected pages via symbol-level provenance.
- Visual: the loop, with the output forking into "human docs" and "agent endpoint"; verifier cascade beneath.
- Speaker notes: The drift report ("your docs disagree with your code in N places") is a near-free byproduct and a credibility stunt. Provenance is the mechanism behind "always current."

**Slide 6 — Why it's different**
- Headline: **The only layer that is generated, verified, owned — and agent-ready.**
- Body: verification + ownership + BYO-compute + AI-native output (`llms.txt`/MCP). Quadrant teaser: docstube top-right, and it's the only one shipping a verified agent endpoint.
- Visual: the quadrant + a small "agent-ready" badge unique to docstube.
- Speaker notes: For a category-creating pitch, the agent-infrastructure framing is the differentiator beyond the quadrant.

**Slide 7 — Market**
- Headline: **Sized on the AI-code economy, not the docs-tools niche.**
- Body: TAM — AI code tools ~$9.35B (2026) → ~$30B (2031), ~26% CAGR (Mordor, analyst estimate); Grand View ~27% CAGR to ~$26B by 2030. SAM — 180M+ developers, 395M public repos + tens of millions private. SOM — bottom-up repos/sites or devs × ACV. Adjacent signal: the category is being bought (Postman→Fern, Anthropic→Stainless).
- Visual: TAM/SAM/SOM funnel; a sidebar of 2026 M&A as "category is consolidating" evidence.
- Speaker notes: For the visionary investor, the M&A activity (Fern, Stainless) signals model vendors are buying toolchain infra — tailwind for us. Flag docs-tools $8B as low-confidence color.

**Slide 8 — Business model**
- Headline: **Open-core: the standard spreads free; the network is the business.**
- Body: OSS free forever (becomes the default way verified docs get made) → Cloud usage-based (cross-project RAG "Ask agent" + MCP — the org-wide verified knowledge graph; governance, audit log) → Enterprise (self-host + SLA).
- Visual: 3-tier ladder reframed as "single repo → org graph → governed estate."
- Speaker notes: The Cloud tier is where the infrastructure thesis monetizes — a cross-project verified knowledge graph agents can query. Supabase/PostHog prove the open-core motion. (Comps reported/estimated.)

**Slide 9 — Competition**
- Headline: **Read-the-code tools explain. None verify, and none are yours.**
- Body: quadrant + honest table. DeepWiki is the closest conceptual neighbor (reads code → explains it) — concede its reach ($26B backing, 50,000+ repos, MCP-native) but note it's hosted, browse-only, unverified, and your code goes to their servers. Mintlify leads hosted authoring + Autopilot.
- Visual: quadrant + table; "owned?" and "verified?" columns are where docstube stands alone.
- Speaker notes: Fair framing — DeepWiki sets the free baseline; we're the verified, owned, agent-ready answer. No trash-talking.

**Slide 10 — Moat / "won't the model vendors just build this?"**
- Headline: **Neutral infrastructure beats a vendor's walled docs mode.**
- Body: deterministic verification + self-owned output + provider-neutral BYO-compute (Claude / Codex / Gemini, no markup) + source never uploaded. A trust layer has to be neutral to be trusted — which is exactly what a single vendor can't be.
- Visual: docstube as a neutral layer spanning multiple vendor models; a vendor's "docs mode" shown boxed inside its own walls.
- Speaker notes: The category argument: infrastructure that verifies AI output must be independent of the AI it verifies. Neutrality is both moat and thesis.

**Slide 11 — Team**
- Headline: **Team**
- Body: `[[PLACEHOLDER: team — to be added]]`. Neutral framing; no names or histories.
- Visual: minimal placeholder.
- Speaker notes: Intentionally minimal per current direction.

**Slide 12 — Vision**
- Headline: **Verified documentation is the substrate of the AI-software era.**
- Body: as software is increasingly written and read by machines, the scarce resource is verified explanation. docstube is building that substrate — neutral, owned, and proven against the source.
- Visual: the stack graphic resolved — code at the base, verified docs as the load-bearing layer, humans and agents on top.
- `[[OPTIONAL — only when raising]]` Ask: `[[PLACEHOLDER: $amount]]` → `[[PLACEHOLDER: use of funds]]`. No projections.
- Speaker notes: Big, credible close. Optional ask only when raising.

---
---

# Variant D — "Docs you'd actually read"

> **Rationale:** Developer-joy / beautiful + open-source bet, warm, playful, community tone, for bottom-up devtools investors and the OSS crowd. The wedge is delight + free + beautiful + yours. Leans on the OSS adoption motion and the open-core playbook.

**Visual system:** Light background, warm and friendly, generous whitespace, rounded shapes, soft teal washes (`#CDEDE6`, `#5EEAD4` accents) over white. A little human warmth — a subtle heart/star for community. Beautiful sample typography on display. Approachable, not corporate.

---

**Slide 1 — Title**
- Headline: **Docs you'd actually read.**
- Subhead: docstube — free, open-source, beautiful docs generated from your code, verified against it, and yours to keep.
- Visual: a gorgeous sample docs page peeking in from the side; docstube lockup; a small `MIT` + `★ open source` chip.
- Speaker notes: Warm, inviting open. Lead with delight and "free + yours." This variant wins hearts before minds.

**Slide 2 — Problem**
- Headline: **Most docs are stale, ugly, and nobody trusts them.**
- Body: (1) They rot the moment code changes. (2) Generic AI doc writers churn out bland, fluent prose that's "almost right, but not quite." (3) Good docs are expensive to write and maintain — so maintainers, who have no budget, go without.
- Visual: a tired, stale wiki page vs. the promise of something clean and current; friendly, not grim.
- Speaker notes: Keep it human and relatable — the maintainer with great code and sad docs. That's our hero.

**Slide 3 — Why now**
- Headline: **There's more code than ever, and the people writing it deserve docs that keep up.**
- Body: AI writes ~20–30% of code at Microsoft (Nadella, Apr 2025), >30% at Google (Pichai, Q1 2025); GitHub Octoverse 2025 — 180M+ developers, ~1B commits (+25% YoY), ~230 new repos every minute. And docs are still the #1 thing developers reach for (84% most-used resource, 2024 SO; 90% use API/SDK docs) — yet ~61–63% lose 30+ min/day just searching for answers. Meanwhile trust in AI accuracy fell to ~29% (SO 2025).
- Visual: a friendly rising "code created" curve with little repo dots (~230/min); a callout on the 30+ min/day time sink.
- Speaker notes: Pair the volume story with the very human "docs are #1 but cost you 30 min a day." The trust drop motivates why verified matters. (Octoverse, SO solid.)

**Slide 4 — Solution**
- Headline: **Free, beautiful, verified, and yours.**
- Body: docstube generates a gorgeous Astro/MDX docs site from your code, checks it against the source, keeps it current on every commit, and runs on the AI you already have. MIT-licensed, every feature free. Pillars: verified · always current · written for your readers · BYO AI.
- Visual: four soft pillar cards with friendly icons; the "beautiful site" front and center.
- Speaker notes: Delight is the wedge here, but verification keeps it credible — "beautiful AND trustworthy." Avoid "zero hallucinations"; say "flagged, never silently wrong."

**Slide 5 — Product / how it works**
- Headline: **Point it at your repo. Get docs you're proud of.**
- Body: structural map → writer agent → per-persona reviewers → deterministic verifiers → ship (or flag) → a beautiful owned site → a GitHub Action opens a PR to keep it current. The drift report tells you where docs and code disagree.
- Visual: the loop drawn friendly and rounded; the verifier cascade as a cheerful checklist `compile ✓ · imports ✓ · refs ✓ · 1 flagged ⚠`; an inset of the auto-PR.
- Speaker notes: The GitHub Action is the viral artifact — auto-PRs keep docs fresh and put docstube in front of every contributor. The drift report makes a fun launch stunt on a famous OSS project.

**Slide 6 — Why it's different**
- Headline: **Verified + beautiful + free + yours — pick all four.**
- Body: the wedge as delight: mechanically verified, genuinely beautiful, MIT-free, fully owned (no lock-in), on your own AI. Quadrant teaser: docstube top-right.
- Visual: four joyful chips; the quadrant tucked in a corner.
- Speaker notes: For the OSS audience, "free + yours + beautiful" is the emotional hook; verification is the credibility that makes it more than a toy.

**Slide 7 — Market**
- Headline: **180M+ developers, ~230 new repos a minute — and we're free to adopt.**
- Body: TAM — AI code tools ~$9.35B (2026) → ~$30B (2031), ~26% CAGR (Mordor, analyst estimate). SAM — 180M+ developers, 395M public repos + tens of millions private. SOM — bottom-up via adopted repos × per-site pricing on the paid tier. OSS maintainers are the beachhead: acute pain, no budget, already on a paid AI plan → docstube is ~free for them.
- Visual: TAM/SAM/SOM circles with a friendly "start free" arrow into the funnel.
- Speaker notes: Bottom-up adoption is the story — flag docs-tools $8B as low-confidence color. The wedge audience is maintainers; the bridge to revenue is teams (next slide).

**Slide 8 — Business model**
- Headline: **Free forever for the community. Paid when your team grows up.**
- Body: OSS free forever (every feature, BYO AI — the love engine) → Cloud usage-based (cross-project "Ask agent" + MCP, governance, audit log, analytics, collaboration) → Enterprise (self-host + SLA). The open-core playbook, proven.
- Visual: 3-tier ladder drawn warmly; community tier celebrated, not minimized.
- Speaker notes: Supabase (~$5B val, ~$70M ARR) and PostHog (~$1.4B val, ~$57.5M ARR) prove free-self-host → paid-hosted/governance works. Free isn't charity — it's the distribution. (Comps reported/estimated.)

**Slide 9 — Competition**
- Headline: **Lovely hosted tools exist. None are free, verified, and yours.**
- Body: quadrant + honest table. Concede the incumbents make polished products (Mintlify, GitBook, ReadMe). Our row: free/MIT + owned output + verified + beautiful by default + BYO compute.
- Visual: quadrant + a friendly table; "free & owned" and "verified" columns are ours.
- Speaker notes: Stay generous — these are good tools. Our difference is the open-source, owned, verified combination, plus genuine design quality. No trash-talking.

**Slide 10 — Moat / "won't the model vendors just build this?"**
- Headline: **Community, craft, and neutrality — not a license — are the moat.**
- Body: deterministic verification + self-owned output + provider-neutral BYO-compute (no markup, source never uploaded), defended by OSS speed, community, and brand. A vendor's docs mode would be walled and on-their-tokens; ours is open and neutral.
- Visual: a community ring around the product; neutral model logos behind it.
- Speaker notes: The defense against idea-copying is speed + community + brand, not the MIT license. Beautiful, beloved, and neutral is hard to clone.

**Slide 11 — Team**
- Headline: **Team**
- Body: `[[PLACEHOLDER: team — to be added]]`. Neutral, community-friendly hiring framing; no names or histories.
- Visual: minimal placeholder with a warm "we're hiring / building in the open" note.
- Speaker notes: Intentionally minimal per current direction.

**Slide 12 — Vision**
- Headline: **Every project deserves docs people actually want to read.**
- Body: free, beautiful, verified, and owned — for the 180M+ developers building the next wave of software, on the AI they already have.
- Visual: a wall of friendly project cards each with a lovely docs site; closing wordmark with `★ open source`.
- `[[OPTIONAL — only when raising]]` Ask: `[[PLACEHOLDER: $amount]]` → `[[PLACEHOLDER: use of funds]]`. No projections.
- Speaker notes: Warm, community close. Optional ask only when raising.

---
---

# Variant E — "Not a docs platform. A docs compiler."

> **Rationale:** Anti-hosting-platform / category-redefinition bet, sharp, contrarian, sales-y-creative, for investors who like a strong wedge and a clear enemy. The quadrant and the "platform vs. compiler" contrast are central; strongest competition + differentiation slides.

**Visual system:** Light background, stark and high-contrast, confident. Teal (`#0097A1`) vs. a muted "old way" grey. Recurring device: "platform ✗ / compiler ✓" and crossed-out incumbent assumptions. Mono headers for the compiler feel. Sharp, declarative.

---

**Slide 1 — Title**
- Headline: **Not a docs platform. A docs compiler.**
- Subhead: docstube compiles documentation from your code — and verifies it against the source, like a build step, not a CMS.
- Visual: the word "platform" struck through, "compiler" set in mono teal; `$ docstube build` beneath the lockup.
- Speaker notes: Lead with the category redefinition. The whole deck reframes docs from "content you host" to "an artifact you compile and verify."

**Slide 2 — Problem**
- Headline: **Docs platforms host your prose. They can't tell you it's wrong.**
- Body: (1) A platform stores whatever you write — stale or not. (2) Bolt-on AI writers generate fluent prose with no idea whether it matches the code. (3) So docs drift, silently, and the platform's job (hosting) was never to catch it.
- Visual: a "platform" as a passive container; code changes underneath while the hosted page stays frozen.
- Speaker notes: Sharpen the contrast: hosting is passive; compiling is active and checkable. The incumbent model structurally can't verify.

**Slide 3 — Why now**
- Headline: **You can't hand-host docs for code that's increasingly machine-written.**
- Body: AI writes ~20–30% of code at Microsoft (Nadella, Apr 2025), >30% at Google (Pichai, Q1 2025), ~95% predicted by 2030 (Kevin Scott); GitHub Octoverse 2025 — ~1B commits (+25% YoY). Trust is going the other way: Stack Overflow 2025 — accuracy trust ~29% (−11 pts), 46% distrust, 66% frustrated by "almost right, but not quite." Hosting more pages faster doesn't fix trust — compiling and verifying does.
- Visual: the dual chart (volume up / trust down); a tag: "a platform scales hosting; a compiler scales trust."
- Speaker notes: Land the why-now, then immediately convert it into the category argument — the moment demands verification, which platforms can't do. (SO/Octoverse solid; 2030 a prediction.)

**Slide 4 — Solution**
- Headline: **`docstube build` — your docs, compiled and checked against your code.**
- Body: docstube reads the repo, drafts on your own AI, and runs deterministic verifiers (samples compile, imports resolve, refs match the compiler); pages retry or ship flagged. Output: an owned site, not a hosted lock-in. Verified, not hallucinated, is the point.
- Visual: a build pipeline rendered like a CI run — green checks, one amber flag, "0 silently wrong."
- Speaker notes: The compiler metaphor is literal: a build step with a deterministic gate. That's why "compiler," not "platform."

**Slide 5 — Product / how it works**
- Headline: **A build pipeline for docs — with a gate that can fail.**
- Body: structural map → writer → per-persona reviewers → deterministic verifiers → retry or ship flagged → owned site → recompile only affected pages via symbol-level provenance.
- Visual: the loop styled as a CI graph; verifier cascade `samples compile ✓ · imports resolve ✓ · API refs match ✓ · 1 flagged ⚠`; a red/green "gate" node.
- Speaker notes: The binary, deterministic publish gate is the compiler's defining feature — quality is a pass/fail check, never an opaque model score. Incremental recompile = "always current."

**Slide 6 — Why it's different (weighted heavy)**
- Headline: **Platform vs. compiler: passive hosting vs. active, verified generation.**
- Body: the full 2×2. x: Passive (hosts docs you write) → Active (generates from code). y: Unverified → Verified. docstube alone top-right. Mintlify/GitBook/ReadMe bottom-left (passive, unverified); DeepWiki/DocuWriter/Penify bottom-right (active, unverified); Swimm top-left (passive, verified).
- Visual: the hero quadrant, full slide, docstube spotlighted top-right.
- Speaker notes: This is E's centerpiece — the quadrant is the argument. Everyone else is missing either "active" or "verified"; only docstube is both. Be fair about where each sits.

**Slide 7 — Market**
- Headline: **The compiler rides the code-tools market, not the docs-hosting niche.**
- Body: TAM — AI code tools ~$9.35B (2026) → ~$30B (2031), ~26% CAGR (Mordor, analyst estimate). SAM — 180M+ developers, 395M public repos + tens of millions private. SOM — repos/sites × per-site, or devs × ACV. The docs-hosting tools market (~$8B by 2025, low confidence) is the incumbent box we're redefining out of.
- Visual: TAM/SAM/SOM; the small "docs-hosting" niche drawn beside the much larger "code-tools" market we anchor on.
- Speaker notes: Reframe the TAM away from docs-hosting (where incumbents sit) toward code-tooling. Flag the $8B docs figure as low-confidence color.

**Slide 8 — Business model**
- Headline: **Free compiler. Paid for the org-scale build system.**
- Body: OSS free forever (the compiler; BYO AI, no markup) → Cloud usage-based (cross-project RAG "Ask agent" + MCP, governance, audit log, analytics) → Enterprise (self-host + SLA). Suggested: banded per-site base + seat/usage hybrid — not per-page (per-page perversely rewards fewer, larger pages).
- Visual: 3-tier ladder framed "local build → org build system → governed pipeline."
- Speaker notes: Supabase/PostHog prove the open-core motion. Call out the pricing-mechanic reasoning to sound rigorous. (Comps reported/estimated.)

**Slide 9 — Competition (weighted heavy)**
- Headline: **Concede hosting. Win verification.**
- Body: the quadrant + a blunt, honest table. Concede incumbents clearly: Mintlify ($500M val, 20,000+ companies, Autopilot incremental updates), GitBook/ReadMe (mature hosting), DeepWiki ($26B backing, MCP-native, 50,000+ repos). docstube's column: generates from code · mechanically verified · owned output · BYO compute · audit log.
- Visual: quadrant beside a feature table; the "verified" and "owned" rows are where only docstube checks.
- Speaker notes: The contrarian framing works only if it's fair — concede generously where incumbents lead (capital, distribution, polish), then win on the axis they can't structurally cross. No trash-talking.

**Slide 10 — Moat / "won't the model vendors just build this?"**
- Headline: **A compiler's gate + neutrality is not a vendor's docs mode.**
- Body: deterministic verification (a real build gate) + self-owned output + provider-neutral BYO-compute (Claude / Codex / Gemini, no markup) + source never uploaded. A vendor would ship a hosted, on-their-tokens "docs mode" — the platform model we're redefining away from.
- Visual: docstube's "compiler gate" vs. a vendor's walled "platform mode," side by side.
- Speaker notes: The two hardest parts to copy are the deterministic verifier and symbol-level provenance. Neutrality is the hedge; a vendor can't be neutral about its own tokens.

**Slide 11 — Team**
- Headline: **Team**
- Body: `[[PLACEHOLDER: team — to be added]]`. Neutral framing; no names or histories.
- Visual: minimal placeholder.
- Speaker notes: Intentionally minimal per current direction.

**Slide 12 — Vision**
- Headline: **Docs become a build artifact — compiled, verified, owned.**
- Body: as software volume explodes and trust falls, documentation stops being content you host and becomes something you compile and prove. docstube is the compiler for that era.
- Visual: `$ docstube build → ✓ verified` resolving into a clean owned site; closing line *not a platform — a compiler.*
- `[[OPTIONAL — only when raising]]` Ask: `[[PLACEHOLDER: $amount]]` → `[[PLACEHOLDER: use of funds]]`. No projections.
- Speaker notes: Sharp, declarative close. Optional ask only when raising.

---
---

## Build notes (for the .pptx)

- 16:9, light backgrounds throughout. Outfit for display/headings, a monospace (e.g. JetBrains Mono / ui-monospace) for terminal/compiler accents.
- Palette: teal `#0097A1`, gradient `#7ED0BE → #36A6A4 → #0A7B85`, deep teal `#004B52`, ink `#0f172a`, slate `#334155`, muted `#64748b`, hairline `#e2e8f0`, surfaces `#f8fafc`/`#ffffff`, mint wash `#CDEDE6`/`#5EEAD4`, verification-green and warning-amber as functional accents.
- Each variant themed distinctly within this system (A terminal/compiler · B bold ownership · C layered infrastructure · D warm community · E stark contrarian).
- Speaker notes embedded on every slide. Soft figures flagged in notes. Team slide minimal. Optional ask marked and placeholdered.

