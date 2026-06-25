<!--
  LIVE homepage copy for docstube.dev  (source: apps/web/src/pages/index.astro + shared data/components)
  This is the canonical copy for the deployed homepage. The numbered files in this folder are older
  exploratory variants — ignore them.

  HOW TO USE
  - Edit the text under each heading. Keep the section/field labels so the copy can be mapped back to the site.
  - Hand this file back when you're done and the edits get applied to the page, then redeployed.
  - "Illustrative UI" blocks are the fake-product mock-ups (terminal/cards). They're real on-screen text but
    secondary — tweak if you like, or leave them.
  - House style: sentence case headings, plain hyphens (no em dashes), mechanism-anchored claims,
    no absolutes like "zero hallucinations" / "100% accurate".
-->

# docstube.dev — homepage copy

## Global / SEO

- **Browser title:** docstube - verified, always-current docs generated from your code
- **Meta description:** docstube reads your codebase, writes your docs, fact-checks every claim against the source, and keeps everything in sync as your code changes. Open-source, MIT, and runs on the AI you already pay for.
- **Tagline (used in footer):** Verified, always-current documentation, generated from your code.

### Header / navigation

- **Nav links:** How it works · Verification · Compare · Pricing · Docs
- **GitHub link label:** stacktape/docstube
- **Primary button (everywhere):** Join the waitlist

---

## 1. Hero

- **Headline:** Most technical documentation is trash. `Yours won't be.`
  - _(`Yours won't be.` is the highlighted/gradient words)_
- **Subheadline:** docstube generates it from your codebase, fact-checks every claim against the source, writes it for the people actually reading it, and keeps it in sync as your code changes. Nothing to write. Nothing to maintain.
  - _("Nothing to write. Nothing to maintain." is set slightly stronger than the rest of the line.)_
- **Trust badges (3, understated):**
  1. MIT licensed
  2. bring your own AI
  3. source stays local
- **Primary CTA:** Join the waitlist
- **Secondary CTA:** How it works

<details><summary>Illustrative UI - the animated walkthrough on the right (loops through 3 steps)</summary>

A device frame (`docstube · localhost:4321`) with a narration band ("Step 1 of 3" + a plain-language title/subtitle), a status pill, and a footer rail `1 · Configure › 2 · Generate › 3 · Verify & fix`. It loops slowly through three scenes:

1. **Configure** - narration _"You set it up in a wizard / Pick a doc type and who the docs are for."_ A form fills itself in: _What are you documenting?_ → **Public docs site**; _Who will read it?_ → **New integrator**, **Platform engineer**. A cursor then clicks **Generate docs**.
2. **Generate** - narration _"It writes the docs from your code / A writer agent reads your source and drafts each page."_ Shows **Writer agent · claude** reading `src/auth/session.ts` and writing `guides/authentication.mdx`, with lines streaming in.
3. **Verify & fix** - narration _"It checks every page, and fixes what is wrong / A verifier catches mistakes and sends them back to the writer."_ A **Writer agent** and a **Verifier** with a hand-off between them. Checks tick: ✓ Code samples run · ✓ Links work · ✗ **Examples match your code** → finding _"getSession() example is out of date"_. The finding is sent back to the writer, the example is rewritten, and the check flips to pass. The quality score climbs **0.62 → 0.94** past the 0.90 gate, then a **Page shipped, verified** toast closes the loop.

(Honors reduced-motion: parks on the final "passed" state instead of looping.)

</details>

---

## Why this matters (the problem) _(NEW - sits right after the hero; renumber when finalizing)_

- **Eyebrow:** Why this matters
- **Section title:** Everyone needs the docs. Every way we make them is broken.
- **Two sourced claims (stat cards):**
  - **84%** call technical docs their number-one way to learn. _(source link → Stack Overflow Developer Survey 2024)_
  - **2 in 3** weigh documentation before they'll adopt an API. _(source link → Postman, State of the API)_
- **Four problem tiles (2x2), each with a lead + example + "How it shows up" list:**
  - **It goes stale** _(tag: every release)_ - Code ships every day; hand-written docs don't move. Examples rot and signatures drift until the page is full of statements that used to be true.
    - _How it shows up:_ A sample that throws the moment you paste it · An option renamed three sprints ago · A "returns a Session" that now returns a Client
  - **It assumes too much** _(tag: most pages)_ - Whoever wrote the code can't un-know it. The obvious step gets skipped, internal names leak in, and the context a newcomer needs never gets written down.
    - _How it shows up:_ A term defined nowhere, used everywhere · A prerequisite nobody mentioned · Jargon that only makes sense from the inside
  - **It never gets written** _(tag: the hard parts)_ - Docs are the chore that loses to every deadline. Configuration, edge cases, the gnarly migration - the pages readers need most are the ones that stay empty.
    - _How it shows up:_ A "coming soon" that shipped two years ago · A heading with one sentence under it · The exact error you hit, documented nowhere
  - **And AI doesn't fix it** _(tag: 30+ / page)_ - Point a model at your repo and the pages read beautifully. Check them against the source and the problems pour out - fluent, confident, and wrong.
    - _How it shows up:_ Methods and flags that don't exist · Two samples on one page that contradict · Claims with nothing in the code behind them
- _Note:_ the "30+ / page" figure is representative/illustrative for a normal page (real dogfooding on a very long page surfaced ~144 combined). Stat sources should be confirmed against the fact bank.

---

## 2. "Runs on" strip

- **Heading:** Runs on the AI you already use
- **Items (logo + name + note):**
  - Claude — subscription or API
  - Codex — OpenAI CLI
  - Gemini — Google CLI
  - Any OpenAI-compatible API — custom base URL

---

## 3. Why docstube (benefit grid, 2 × 3)

- **Eyebrow:** Why docstube
- **Section title:** Docs you can actually trust, and never have to babysit.

| # | Card title | Body |
|---|---|---|
| 1 | Verified, not hallucinated | Samples type-check, imports resolve, and API references are matched to your real compiler signatures. Anything unverifiable ships flagged, never silently wrong. |
| 2 | Complete | Generated from a structural map of your whole codebase, so the things that matter get documented instead of quietly left out. |
| 3 | Written for your readers | Define your reader personas once. A reviewer agent per persona checks every page for the right depth and tone before it ships. |
| 4 | Efficient regeneration | Change your code and only the affected pages regenerate, tracked at the symbol level. Locally, or automatically via the GitHub Action. |
| 5 | Beautiful and modern | A self-contained Astro site you own. Fast, with built-in search, rendered D2 diagrams, and an autolinked glossary. |
| 6 | Fast and efficient | Every agent step is cached by content hash, so reruns skip unchanged work and you only spend tokens on what actually changed. |

---

## 4. How it works (four-step walkthrough, tabbed)

- **Eyebrow:** How it works
- **Section title:** Four steps. You drive the first one, it does the rest.
- **Intro:** From npx to a site you own. Walk each step of a real run below.
- **Tabs:** `1. Configure` (tag: **you**) · `2. Generate` (tag: **AI**) · `3. Review & verify` (tag: **AI**) · `4. Stay in sync` (tag: **AI**)

### Tab 1 — Configure

- **Heading:** Configure it once, then step back.
- **Body:** The wizard proposes a nav tree from your codebase. You edit it like a list: reorder, rename, add or drop pages. Pick a doc type, name the people who'll read it, paste any context that isn't in the code. That's the whole setup. From here it runs on its own.
- **Bullets:**
  - Personas become per-audience reviewer agents.
  - The nav tree becomes the page plan.
  - Your source never leaves your machine.
- _Illustrative UI:_ doc-type chips (Public docs site / Internal wiki / API reference), persona rows (New integrator · wants the 5-minute path; Platform engineer · depth, edge cases, config), an editable nav tree.

### Tab 2 — Generate

- **Heading:** A build log you can actually watch.
- **Body:** A writer agent drafts each page from a structural map of your source. Pages stream into the preview as they finish. The timeline shows exactly where the run is: verified, drafting, or flagged. Nothing happens in a black box.
- _Illustrative UI:_ per-page CI timeline (3 verified, 1 running, 1 flagged) + a live-preview pane.

### Tab 3 — Review & verify

- **Heading:** Reviewed and verified, both automatic.
- **Body:** Every page clears two checks before it ships, with no human in the loop. A reviewer agent per persona judges audience fit, depth, and tone. Then deterministic verifiers run real tools against it: tsc, pyright, import and link resolution, D2 rendering, and API references matched to your compiler.
- **Callout (⚠):** A page that can't clear both arrives **flagged, never silently wrong**, with the exact finding attached.
- _Illustrative UI:_ per-persona scores (0.92 / 0.88), deterministic checks (tsc, pyright, imports, links, D2 render, API refs), "Passed the gate · quality 0.94 / 1.0".

### Tab 4 — Stay in sync

- **Heading:** A diff that thinks in symbols.
- **Body:** docstube hashes your codebase at the symbol level. Change a function and it knows exactly which pages depend on it, then regenerates only those. Everything else is skipped, so a refresh costs a handful of tokens instead of a full rebuild.
- **Bullets:**
  - Symbol-level diffing with normalized hashes, not a blunt file scan or a full re-run.
  - Only the affected pages reach the model, so you spend a fraction of the tokens.
  - Run it locally, or let the GitHub Action keep docs current automatically.
- _Illustrative UI:_ "~96% fewer tokens" badge · changed symbols (`getSession()`, `refreshToken()`, `AuthError`) · 2 pages regenerate / 47 untouched · tokens ~11k vs ~294k for all 49 pages · "Runs automatically via the GitHub Action."

---

## 5. Verification

- **Eyebrow:** Verification
- **Section title:** Mechanically checked, not vibe-checked.
- **Intro:** Reviewer agents judge audience fit. But before any page ships, deterministic verifiers run real tools against it: tsc, pyright, link and import resolution, D2 rendering, API references matched to the compiler.
- **"Same gate as your CI" card:**
  - Title: Same gate as your CI
  - Body: A page that can't pass doesn't quietly ship. It retries with the verifier's feedback, or it ships flagged for a human, with the exact finding attached, so review takes seconds, not an afternoon.

<details><summary>Illustrative UI — verifier terminal + drift report</summary>

- **Verifier cascade** (terminal, `npx docstube refresh` on `api/create-client.mdx`). Check labels:
  - MDX compiles + component props valid
  - TypeScript samples type-check (tsc)
  - Python samples check (pyright)
  - Imports + paths resolve
  - Internal + external links resolve
  - D2 diagrams render
  - API references match compiler signatures
  - Migration guide - needs a human _(this one is flagged)_
- **Drift report** (titled "Drift report", tagged "example"):
  - `getUser(id)` — signature changed → 2 pages affected
  - `POST /v2/sessions` — endpoint removed → 1 page flagged
  - `export useFlags()` — new export → undocumented
  - `auth/overview.mdx` — still matches source
  - Footer: `docstube refresh` regenerates only the affected pages.

</details>

---

## 6. Comparison

- **Eyebrow:** Where it sits
- **Section title:** Active generation. Mechanical verification. Yours.
- **Intro:** Hosting platforms organize the docs you write by hand. AI tools generate text and hope. docstube generates from your code, verifies the output, and hands you a site you own.

**Positioning quadrant** (axes: _Hosts docs you write ↔ Generates from your code_ × _Verified ↔ Unverified_):

- Top-left (verified, hosted): Code-coupled tools
- Top-right (verified, generated): **docstube**
- Bottom-left (unverified, hosted): Hosted docs platforms
- Bottom-right (unverified, generated): Generic AI doc tools

**Capability table** (columns: Open source · Reads your actual code · Runs on your AI subscription · Mechanically verifies output · Incremental updates · You own the output):

| Tool | Open source | Reads code | Your subscription | Verifies | Incremental | You own |
|---|---|---|---|---|---|---|
| **docstube** | MIT | Yes | Yes | Yes | Symbol-level | MDX / Astro |
| Hosted docs platforms | No | Via AI add-on | No - metered credits | No verifier | File-hash scan | Their platform |
| AI doc generators | Mostly no | Yes | No - own models | No verifier | Re-generates | Varies |
| Claude + you | n/a | Yes | Yes | No verifier | Manual | Markdown in repo |

- **Table footnote:** Incumbents lead on polish and maturity. docstube's wedge is the combination: active generation, mechanical verification, your own compute, and output you own.

---

## 7. Built for agents

- **Eyebrow:** Built for agents
- **Section title:** Docs your LLMs can read, too.
- **Cards (3):**
  1. **llms.txt + llms-full.txt** — Every site ships a compact and a full machine index, so your own agents read accurate, current context instead of guessing.
  2. **Docs-serving MCP server** — Point Claude, Codex, or any MCP client at your docs and let it answer from verified pages - not a stale crawl.
  3. **Compiler-extracted API refs** — References are pulled from real signatures via TypeDoc and griffe, so the types agents read match the types you ship.
- _Illustrative UI:_ a small `llms.txt` sample in a terminal.

---

## 8. Pricing

- **Eyebrow:** Pricing
- **Section title:** Free forever. Every feature.
- **Intro:** The open-source tool is the whole product. You pay only for your own AI usage, with caps you set. A hosted Cloud tier is optional, for teams that want everything in one place.

### Tier 1 — Open source _(highlighted "Start here")_
- **Price:** Free forever
- **Tagline:** Every feature. Bring your own AI.
- **Points:** The complete CLI, web UI, and GitHub Action · Verified, persona-targeted docs · MDX + Astro output you own · MIT-licensed · community support
- **CTA:** Join the waitlist

### Tier 2 — Cloud
- **Price:** Usage-based
- **Tagline:** Everything in open source, hosted.
- **Points:** All your projects' docs in one place · Cross-project "Ask agent" + MCP · Governance, audit log, analytics · Collaboration + company-wide defaults
- **CTA:** Join the waitlist

### Tier 3 — Enterprise
- **Price:** Custom
- **Tagline:** Everything in Cloud, plus control.
- **Points:** Self-hosting · SLA + onboarding · Enterprise support · Security review
- **CTA:** Talk to us

---

## 9. FAQ

- **Eyebrow:** FAQ
- **Section title:** The honest answers.

1. **Does my code leave my machine?**
   No. docstube servers never receive your source, prompts, or generated docs. Your code is only ever sent to the AI provider you choose, through your own credentials - exactly like your normal agent usage.
2. **Which AI providers can I use?**
   Your own Claude, Codex, or Gemini CLI - subscription or API key - or any OpenAI-compatible or Anthropic-compatible endpoint via a custom base URL. Any model you can already reach.
3. **Do I own the output?**
   Yes. docstube generates a self-contained MDX + Astro site into your repo. No platform lock-in, nothing to keep paying for to keep your docs online.
4. **Is it really free?**
   Yes - every feature, MIT-licensed. You pay only for your own AI usage, with spend caps you set. A hosted Cloud tier is optional and adds cross-project features.
5. **How can it claim docs are correct?**
   It doesn't claim perfection. Deterministic verifiers mechanically check what is checkable - samples type-check, imports resolve, links work, API references match your compiler. Anything that can't be verified ships flagged for review, never silently wrong.
6. **What languages does it support?**
   TypeScript and Python today, with compiler-extracted API references via TypeDoc and griffe. The structural map is tree-sitter-based, so more languages can follow.

---

## 10. Closing CTA (waitlist band)

- **Headline:** Be first to stop maintaining docs by hand.
- **Subheadline:** docstube is launching soon. Join the waitlist and we'll send you a single email the day it's ready.
- **Button:** Join the waitlist
- **Microcopy:** Early access · no spam, just one launch ping.

---

## Footer

- **Tagline:** Verified, always-current documentation, generated from your code.
- **Button:** Join the waitlist
- **Columns:**
  - **Product:** How it works · Verification · Compare · Pricing
  - **Open source:** GitHub · MIT license · Changelog · Contributing
  - **For agents:** llms.txt · MCP server · API references · FAQ
- **Bottom line:** Open source · MIT · your code never leaves your machine.
- **Credit:** Generated by docstube ✦
