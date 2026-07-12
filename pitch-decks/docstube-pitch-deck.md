# docstube — Investor Pitch Deck

**16 slides. Verified docs, generated from your code.** Pre-product, open-source (MIT).

- Rendered deck: [`docstube-pitch-deck-v2.pptx`](docstube-pitch-deck-v2.pptx)
- Editable source: [`deck-src/`](deck-src/) — each slide is a self-contained HTML page; `shoot.mjs` screenshots them, `build.mjs` assembles the `.pptx`. Rebuild with `npm run build`.
- Design: teal/light theme, one self-standing title per slide, monospace accents, footer `docstube · VERIFIED, NOT GUESSED · page #` on every content slide.
- Standing rules: no team/ask/traction claims; never "zero hallucinations" (use "flagged, never silently wrong"); all product screenshots are illustrative mocks.

---

## 1 · Cover
> **Most technical documentation is trash. Yours won't be.**

- Eyebrow: `VERIFIED DOCS, GENERATED FROM YOUR CODE`
- Sub: docstube generates it from your codebase, fact-checks every claim against the source, writes it for the people actually reading it, and keeps it in sync as your code changes. **Nothing to write. Nothing to maintain.**
- Trust row: ✓ MIT licensed · ✓ Bring your own AI · ✓ Source stays local
- Visual: the run UI at its "all passed" state — verifier checklist (code samples run, links work, examples match your code), "fixed getSession() example, now matches your code," Quality score 0.79 / 1.0.

**Notes:** The whole thesis in one line: verified docs, generated from your code, on your own AI, that you own. Everything after proves those four claims.

---

## 2 · Every way we write docs today is broken.
Three failure-mode tiles:
1. **It goes stale** — Code ships every day; hand-written docs don't move. `docs: getSession()` (struck) vs `code: getSession(opts)` → "out of sync with the source."
2. **It assumes too much** — The author can't un-know the code. Doc: "Initialise the client with your workspace token." → "…what's a workspace token, and where do I get one?"
3. **It never gets written** — Quickstart ✓, Installation ✓, Configuration ○ empty, Migration guide ○ empty.

**Notes:** Not a tooling gap, it's structural. Humans can't keep docs correct, complete, and written for the reader at the speed code moves now. Every team has all three.

---

## 3 · Any AI can write your docs. That's the easy 10%. / Making sure they're right is the hard 90%.
Visual: the `docstube verify` report — red **77 problems found**, three columns:
- **Deterministic failures (41):** code samples don't type-check, imports don't resolve, dead links, diagrams fail, API refs mismatched.
- **Audience-review flags (19):** too advanced for newcomers, steps a beginner can't follow, missing the "why."
- **AI-review flags (17):** claims with no source, internal contradictions, examples that don't match the prose.
- Resolution band: **docstube corrected 68 and re-verified · 9 flagged for human review** — *every other tool ships all 77.*

**Notes:** One model or prompt writes docs that look right but can't reliably find its own mistakes. docstube's supervised, multi-step, agentic checking is what makes finding and fixing the wrong parts reliable. This drift report is the artifact the go-to-market weaponizes later.

---

## 4 · This became buildable a year ago.  *(new)*
Changelog card, year by year:
- `2024` — AI could write fluent text about code it barely understood. That's where confident, wrong docs come from.
- `2025` — Agents learned to read an entire codebase and write about it coherently. Generating docs from code stopped being a demo.
- `2026` *(highlighted)* — **Docs found a second reader: AI agents.** A person skims a wrong page and gets annoyed. An agent follows it and breaks things.

Stat chips:
- **45.3%** of docs traffic is now AI agents, not people. — *Mintlify · State of agent traffic, Mar 2026*
- **96%** of developers don't fully trust AI-written code. — *Sonar · State of Code survey, 2026*

Origin line: We learned this the hard way. Five weeks documenting Stacktape, and a pipeline built to survive it. **That pipeline is where docstube comes from.**

**Notes:** The 2026 row is the key beat — it turns verification from a nice-to-have into infrastructure, because agents execute what they read. The origin line carries the story; don't expand it on the slide.

---

## 5 · Three checks. Pass all three, or it doesn't ship.
Three method cards:
1. **Deterministic verification** *(real tools, real signatures)* — code samples type-check (tsc, pyright), imports & links resolve, D2 diagrams render, API refs match your compiler. *Mechanical truth.*
2. **AI verification** *(judgment tools can't make)* — every claim backed by the source, examples match real behavior, no contradictions across pages.
3. **Per-persona review** *(one reviewer agent per reader)* — New integrator fit 0.92, Platform engineer fit 0.88.
- Result band: **Pass all three checks and the page ships.** Anything we can't prove gets flagged for a human. **Never silently wrong.**

**Notes:** The moat. Deterministic (true/false no matter how smart the model is), AI judgment (soft correctness a compiler can't check), audience fit. The deterministic layer is the one no competitor has — remember it for the comparison slide.

---

## 6 · Five steps. You drive the first. It does the rest.
1. **Configure (YOU · ~5 min)** — Point it at your repo. Pick a doc type, name your readers, edit the nav. Takes about five minutes.
2. **Generate (AI)** — A writer agent drafts MDX from a structural map of your code.
3. **Review (AI)** — One reviewer agent per persona checks audience fit.
4. **Verify (AI)** — Deterministic + AI verifiers prove every claim.
5. **Stay in sync (AI)** — Only affected pages regenerate; the GitHub Action opens a PR.
- Retry loop (drawn back to the writer): **A check fails?** Review and verify send the page back to the writer, rewritten and re-checked, until it passes or gets flagged.

**Notes:** The loop is the product. Generation is cheap; the value is the review-and-verify cycle. Configure once; it maintains forever.

---

## 7 · It builds a real docs site, not just markdown.
Visual: a generated docs-site mock — left nav (Getting started / Guides / API reference), an "Authentication" page with language-tabbed syntax-highlighted code and a Client → Acme API → Postgres diagram, right-hand "On this page" ToC, top search. *(No "Ask AI" element — that's a Cloud feature, kept off to protect the runs-on-your-AI, source-stays-local story.)*
Feature tiles: Instant search · Type-checked code · **LLM-ready** (llms.txt + a docs MCP server) · **Beautiful & owned** (Astro/MDX, MIT, host it anywhere).

**Notes:** Answers "is the output actually good, or just generated markdown?" A real, fast, beautiful docs site you own, natively machine-readable.

---

## 8 · The most efficient regeneration.  *(edited visual)*
Left: docstube hashes your code at the **symbol level** — only dependent pages regenerate.
- **Symbol-level provenance** — a map of which pages each symbol feeds, not just a file scan.
- **A fraction of the tokens** — only the pages a change touches reach the model.
- **On every commit** — the GitHub Action regenerates and opens a PR, with the reasons.

Right (mock GitHub PR by `docstube[bot]`): **Open · #128** — `docs: getSession() example, signature changed in a3f9c41`; diff `- getSession()` → `+ getSession(opts)`; **All checks have passed** (code samples type-check, links resolve, examples match code); footer `2 pages regenerated · 47 skipped · ~11k tokens vs ~294k full rebuild`.

**Notes:** The efficiency moat, and it sets up the objections later. Better models don't remove it — regenerating everything on every commit is always wasteful. A human still approves the merge.

---

## 9 · Win adoption. Unblock your team.
Two audience cards:
- **Public docs** *(Open-source maintainers · API companies)* — **Your docs are your funnel. Good ones win users, bad ones lose them.** You write nothing (generated from your code); built-in AI answers; free, open-source, yours to host.
- **Internal wikis** *(Engineering teams — accent-bordered, the priority)* — **The wiki people finally trust, because it can't be silently wrong.** New hires ramp in days; engineers self-serve; runs on your own AI, code stays local.
- Bottom line: *Public docs earn attention. Internal wikis earn the revenue.*

**Notes:** Two audiences, two jobs. Public = the distribution engine (free, viral). Internal = the real target and where the money is. Public is how we reach the companies internal monetizes.

---

## 10 · The comparison.
Six-capability matrix — columns **docstube · Mintlify · GitBook · DeepWiki · Dosu · DIY**:
| Capability | docstube | others |
|---|---|---|
| Deterministic verification | ✓ | ✗ everywhere (DIY ◐) |
| AI-based verification | ✓ | ◐ |
| Per-persona audience fit | ✓ | mixed |
| BYO AI · source stays local | ✓ | mostly ✗ |
| Updates efficiently | ✓ | ◐ |
| Open-source | ✓ | mostly ✗ |
- Source line: June 2026 competitive review; docstube cells are design targets (pre-product).
- Punchline: one row (Deterministic verification) is blank for every shipping tool. **That empty row is what docstube owns.**

**Notes:** The payoff slide. That blank row is the whitespace docstube is built to own.

---

## 11 · Why we win.
Three pillars ("we," not "I"):
1. **Open-source wins developer tools** — the tools out there are paid and closed; the free open one usually wins, and to beat it you have to be far better. We are the open one.
2. **Verification is new, and nobody else does it** — the one thing no shipping tool has. By the time someone copies it, our open-source product already owns the space.
3. **It's what we're good at, and we've started** — we've built devtools before, we're good at DX, and we spent five weeks on this exact problem building Stacktape's docs. Not a whiteboard idea.

**Notes:** Why *this* market is winnable, not a general startup law: open-source option in a paid market, unclaimed verification wedge with a compounding OSS lead, and real founder-market fit with a head start.

---

## 12 · Open source is great for distribution.
Why open-source spreads on its own (four tiles):
1. **Free channels reward it** — GitHub trending/stars, Hacker News, Reddit, dev newsletters feature open-source for free. Paid SaaS has to buy its way in.
2. **Instant time to value** — free, MIT, runs locally; from seeing it to running it on their repo in minutes.
3. **No barriers to entry** — no procurement, security review, or budget sign-off. A developer just installs it.
4. **Developers trust and share it** — recommended freely; some become contributors (free work, free word of mouth).
- *So we don't need a big marketing team or budget to get started.*
- **First growth play — the drift report:** point docstube at well-known OSS projects and publish what it finds ("your docs disagree with your code in N places"), then offer to fix and host those docs free.

**Notes:** One-year goal: become the default open-source docs tool. Open-source is structurally cheaper to grow. The drift report is the opening move, not a guaranteed viral engine.

---

## 13 · Free wins the category. Cloud earns the revenue.  *(new)*
Three tiers:
1. **Open-source** `FREE FOREVER` — every feature; your AI, your infra, your source never leaves; community support. *The adoption engine.*
2. **Cloud** *(usage-based — the priority tier)* — all your projects' docs in one brain: an Ask agent and a coding-agent MCP across every repo, a fleet docs-health dashboard, governance/audit log/SSO. `entry ~$10–15k / yr · the open-core norm`.
3. **Enterprise** — everything in Cloud, self-hostable; SLA, onboarding, enterprise support. *Fixed, custom pricing.*
- Bottom line: **We never mark up tokens. Cloud sells what a single repo can't have.**

**Notes:** Open-core. MIT tool is genuinely free and drives adoption; Cloud sells the cross-repo layer, not resold tokens. The ~$10–15k/yr floor is within open-core norms (Grafana publishes $25k, Read the Docs $10k) and doubles as a mid-market filter.

---

## 14 · Common objections.
1. *"Won't models get so good they won't need verification?"* → **The opposite.** More models → more code and docs → more unverified claims, not fewer. A wrong API signature is wrong no matter how good the model is.
2. *"Won't an incumbent like Mintlify just add verification?"* → **They can't change what they are.** Their products are built for the human-writes-the-docs era; going AI-native cannibalizes the paid, hosted business they sell.
3. *"Doesn't bring-your-own-compute depend on the AI vendors' terms?"* → **The risk works in our favor.** Saving tokens is already an advantage, so anything that makes tokens pricier makes it bigger.
- Closing: *As AI spreads, verification gets more valuable, not less.*

**Notes:** Confidence, not defense. Each worry, examined, favors us. The trend everyone worries about — AI everywhere — is the tailwind under this company.

---

## 15 · Two possible exit strategies.  *(edited)*
Two options: **Get acquired** (nearer term, strong precedent) · **Build a Cloud business** (bigger, longer; the open-core path). *We don't have to choose now. Wide adoption is what makes either one possible.*

The layer is being bought (chronological M&A strip):
| Date | Deal | Type | Figure |
|---|---|---|---|
| Dec 2025 | Bun → Anthropic | Acquired | ships in Claude Code |
| Jan 2026 | Fern → Postman | Acquired | docs + SDK generation |
| Mar 2026 | Astral → OpenAI | Acquired | uv & Ruff, team joins Codex |
| Apr 2026 | Mintlify | Funded | **$500M** Series B |
| May 2026 | Stainless → Anthropic | Acquired | **~$300M** *(reported, The Information)* |
| May 2026 | DeepWiki (Cognition) | Free, at scale | **$26B** Cognition round |
- Caption: **The toolchain-and-docs layer is being bought,** from three directions at once — API & developer-experience platforms, frontier model labs, and funded independents at scale.

**Notes:** Whoever owns the machine-readable docs layer owns a piece of every AI product. Adoption is the asset; it converts by acquisition or a standalone Cloud business. Label numbers honestly — Stainless ~$300M is reported; Mintlify's $500M was co-led by a16z + Salesforce; Cognition's $26B is post-money.

---

## 16 · Shipping in Q3.
Roadmap (directional, unquantified): **Q3 2026** open-source release + the drift-report campaign → **Q4 2026** adopted by real teams and open-source projects (the free version) → **Q1 2027** Cloud launch and first paying customers.
- Vision (the close): **One day, every new repo starts with a `.docstube` folder. Verified docs, by default.**
- CTA: docstube.dev · Join the waitlist

**Notes:** Vision plus near-term momentum. Free adoption first, revenue later; the goals are directional, not forecasts. The `.docstube`-folder line is the ubiquity the exit rests on.
