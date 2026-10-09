> _Historical research artifact (2026-07). Evidence base for PRODUCT.md. Where any recommendation here conflicts with PRODUCT.md, PRODUCT.md wins._

# docstube Product Plan: Competitor Feature Mining & Prioritized Proposals

## TL;DR (highest-conviction recommendations)

1. **Double down on the verification wedge by extending deterministic verifiers to the assets competitors get wrong.** The single loudest, most-quotable complaint across the whole AI-docs landscape is that auto-generated architecture diagrams are "handwavy," "not engineering quality," and hallucinated ("the graphs just don't make any sense"; DeepWiki drew LibreOffice using a build system it never used). docstube already ships D2 with syntax/render verification — it should add _semantic grounding_ (every node/edge must map to a symbol in the codemap) and make "verified diagram" a headline feature. This is the clearest whitespace in the market.

2. **Ship a standalone free `docstube audit` / drift-report command as the GTM wedge AND a product surface.** Dosu, Swimm, and Mintlify all monetize "docs drift," but none publish a free, deterministic, type-checked drift report. This is the "point docstube at OSS projects" growth play made concrete, and it directly rides the 28.9%-of-repos-document-dead-symbols stat.

3. **Make OpenAPI/AsyncAPI a first-class source next to code, and add a `docstube diff` breaking-change/changelog story.** Every serious competitor (Mintlify, Fern, Bump.sh, Redocly, Scalar, ReadMe, Speakeasy) treats OpenAPI as central; Bump.sh's `bump diff --fail-on-breaking` is directly relevant to docstube's changelog. Without OpenAPI ingestion + an interactive API reference, docstube cannot compete for the "API company" audience it names in its own deck.

4. **Add a privacy-respecting "docs gaps from questions" loop.** kapa.ai's Coverage Gaps (clusters unanswered/uncertain questions into a documentation backlog) is one of the most-praised, most-defensible features in the market. A local-first version — mining the docs-MCP server's own query logs to flag missing/weak pages — feeds docstube's feedback categorizer and strengthens the "docs that stay useful" story.

5. **Match the emerging agent-ecosystem conventions exactly: serve `.md` at every doc URL, keep llms.txt/llms-full.txt, name MCP tools to match DeepWiki's de-facto set, and emit/refresh AGENTS.md.** These are cheap, and the payoff is that agents on the user's own team benefit automatically — which is docstube's most natural distribution loop.

6. **Add a lightweight "was this helpful?" feedback widget on generated sites, feeding the categorizer.** ReadMe (page voting), GitBook (page ratings), and Mintlify (PostHog analytics) all have this; it is table-stakes and it's a first-party signal for the "improve worst pages first" `refine` command.

7. **Prioritize language expansion in the order Java → Go → Rust → C# → PHP.** Java and Go are the clear top tier of demand for auto-generated code docs; the parser-based tool RepoAgent explicitly lists "Java, C or C++" first on its roadmap.

8. **Do NOT build Mermaid, versioned docs, i18n, migration importers, or hosted free hosting now** — but note that i18n and versioned docs are among the single most-upvoted requests in Docusaurus/Starlight/MkDocs communities, so they are the strongest candidates to revisit post-v1. _(Note: PRODUCT.md later revised this — versioned docs, i18n, and importers-as-context ship in v1.)_

---

## 1. Competitor Feature Catalog with adopt/adapt/skip verdicts

### Mintlify

- **Autopilot / Workflows / Automations.** Recurring agent tasks that watch the codebase, clone relevant repos, follow a prompt, and either open a PR or push directly. Pre-built workflow templates now cover changelog generation, API-docs sync, feature-doc drafts, broken-link detection, and SEO audits. Also can generate a whole docs site from a repo by swapping `github.com`→`mintlify.com`. **Verdict: ADAPT.** docstube's `refresh` + GitHub Action already does the watch-and-PR loop; the gap is _templated_ recurring tasks (SEO audit, broken-link sweep, changelog). Adopt these as named `refresh` sub-tasks. docstube's differentiator is that its PRs are verification-gated, not just "drafted."
- **API Playground.** Auto-generated from OpenAPI 3.0+, interactive "try-it" console, auth (API key/Bearer/basic), configurable code examples in curl/python/javascript, `display: interactive|simple|none`, proxy control. Perplexity chose Mintlify specifically for this. **Verdict: ADOPT (as new feature).** This is the biggest single capability docstube lacks for the API-company audience.
- **Analytics via PostHog.** Surfaces top pages, drop-off, and "what users search for but don't find." **Verdict: ADAPT** — docstube already uses PostHog for opt-out telemetry; offer a local-first/privacy-respecting docs-analytics option.
- **Broken-link checker** (`mint broken-links` CLI, runs in CI). **Verdict: ADOPT** — docstube already verifies internal+external links; expose it as a standalone `check links` for parity and for the audit play. Note a real user pain: their broken-link checker can't ignore OpenAPI-spec pages lacking local MDX (mintlify Discussion #1516), suggesting docstube should ship a configurable ignore-list from day one.
- **Pricing pain / lock-in.** Mintlify's Pro plan is **$250/month ($3,000/yr), including 5 editor seats plus a monthly AI-credit allocation; AI overages are billed per credit and extra seats ~$20/mo; SSO/SOC 2 sit behind a Custom/Enterprise tier starting ~$600/mo.** (Some 2026 sources report Mintlify has been simplifying its public tiers — verify current pricing before external publication.) "Hard to justify" pricing and unpredictable metered AI cost are the most common public criticisms on Reddit/HN. **Verdict: this is docstube's opening** — MIT core, BYO-AI (no metered credit risk), ejected Astro site (no lock-in).

### Dosu

- **0-100 freshness score in CI.** Three deterministic signals — git-age delta, frontmatter TTL (`ttl_days`, soft decay), symbol drift — plus a Claude semantic layer for the 35-64 "gray zone." Posts sticky PR comment with per-page deltas; SLO gate (median <75 fails; any `critical:true` page ≤60 fails); `bypass-freshness-gate` label. **Verdict: ADAPT.** docstube's provenance/quality-score system is richer, but Dosu's _explicit numeric freshness SLO gate with a bypass label_ is a clean UX pattern docstube should mirror in its GitHub Action output. docstube's edge: it type-checks and compiler-verifies, which Dosu explicitly does not.
- **Self-documenting PRs.** On merge, finds related published docs, updates them, posts a summary comment; draft docs ignored so users control what's auto-maintained. **Verdict: ADOPT the "draft vs published/maintained" distinction** — docstube should let users mark pages as "not auto-maintained."
- **Doc generation with citations** linking to code files/issues/PRs/conversations; draft→review→published states. **Verdict: docstube already stronger** (symbol-level provenance + verification).
- **Knowledge-base sync to Notion/Confluence/Coda/GitLab; maintains AGENTS.md/CLAUDE.md/SKILL.md directly in repos; MCP server building team memory.** **Verdict: report for monetization audience** — Confluence/Notion sync is a recurring ask for internal-wiki teams.

### Swimm

- **Smart Tokens + Auto-sync (patented).** Docs are coupled to code (path/file/line/snippet/variable); on code change, Auto-sync uses line markers, token references, change size, and _full git history_ (won't work on shallow clones) to decide auto-update vs "ask a human to reselect." Explicitly has NO knowledge of types/compiler output. Runs in IDE (VS Code + JetBrains) and CI. **Verdict: docstube's symbol-hash + provenance approach is architecturally superior** (it _does_ know types via tsc/pyright). Swimm's key limitation — "we can't document a negative" when code vanishes — validates docstube's "flag, never silently wrong" stance. **ADAPT the IDE-surface idea.**
- Note: Swimm supports Mermaid and is pivoting to COBOL/mainframe modernization — a signal it's vacating the modern-dev-docs space docstube targets.

### DeepWiki (Cognition) + deepwiki-open (AsyncFuncAI, ~16.4k stars)

- **Auto-generated wiki + architecture diagrams + `ask_question` MCP.** The MCP server (launched May 22, 2025) is a free, remote, no-auth service at `mcp.deepwiki.com/mcp`, exposing three tools: `read_wiki_structure`, `read_wiki_contents`, `ask_question` (the de-facto standard set; `/mcp` Streamable HTTP now preferred over deprecating `/sse`). Cognition indexed 50,000+ top public GitHub repos (~4B lines of code). Auto-refreshes wikis whose repo carries a DeepWiki badge. **Verdict: ADOPT the MCP tool-naming convention** so agent ecosystems work out-of-the-box. **ADAPT the badge idea** into a "verified by docstube" badge.
- **Diagrams are the #1 polarized feature** — loved on small/unfamiliar repos ("the auto-overviews and diagrams are great," HN), savaged on large/known ones ("not engineering quality," "too handwavy to be useful," "the graphs just don't make any sense," a hallucinated LibreOffice build system). **Verdict: this is docstube's biggest opportunity** — verified, source-grounded diagrams.
- deepwiki-open top issues: large-repo/context-length failures (#468), superficial analytical depth + wrong hyperlinks (#230), periodic re-sync/index updates (#402), S3/self-hosting (#367), multi-repo bridging (#66), model/provider flexibility (Bedrock #41, Voyage/OpenRouter embeddings). Maintainers also angry about unsolicited, inaccurate AI docs and "AI-slop bug reports."

### GitBook

- **Change requests / review workflow, bi-directional Git sync, visual editor, MCP server + MCP analytics, llms.txt, AI Assistant/Agent, webhook/Slack "docs updated" alerts with `updatedBy`.** **Verdict: docstube's review UI already covers the review-workflow need.**
- **Biggest complaints (well-documented post-mortems):** proprietary Markdown lock-in ("no direct Markdown export … full of proprietary block formats"), Git-sync conflicts (README duplication, merge-conflict false positives), and _no doc-change subscription/notification mechanism_ (no email/RSS/webhook "watch this endpoint"). **Verdict: docstube wins on lock-in** (ejected standard Astro/MDX). **ADOPT a change-notification/subscription surface** — this is an explicit, repeatedly-cited gap.

### ReadMe

- **API Metrics from real request logs** (Metrics SDK in Node/PHP/Python/.NET/Ruby): top endpoints, API errors, new users, per-developer request history embedded in docs ("My Requests"), replay for debugging. **Doc Metrics:** page views, page voting (thumbs up/down + comment), search-term tracking. **Verdict: ADOPT page voting** (feedback widget). **Report only** the real-API-log-metrics — out of scope for a static-site generator, but it shows the "docs informed by real usage" theme.
- Owlbert agent (style linting + doc audits), Ask AI, llms.txt + MCP. **Verdict: docstube's reviewer agents already cover style/audit.**

### API-reference specialists: Bump.sh, Redocly, Scalar, Speakeasy, Fern

- **Bump.sh `bump diff` / API changelog.** `bump diff a.yml b.yml` produces human-readable OpenAPI/AsyncAPI diff; `--fail-on-breaking` (auto-on when `CI=1`); GitHub Action auto-comments PRs with the diff; weekly changelog digest email to subscribers; can also deploy an MCP server from Arazzo/Flower workflow docs. **Verdict: ADOPT the diff/breaking-change pattern** for docstube's changelog story. The single most directly-relevant competitor feature to docstube's own changelog pipeline.
- **Redocly:** OpenAPI + AsyncAPI rendering with structural linting/governance. **Scalar:** try-it console, Speakeasy Docs partner. **Verdict: report** — reinforces that OpenAPI ingestion + try-it are table-stakes for API docs.
- **Fern / Speakeasy:** generate SDKs _and_ docs from one API definition, with per-language code samples (Fern: 9 languages incl. Swift; Speakeasy: 10 incl. Terraform/Unity). Fern generates docs+SDK from one source so code samples stay in sync; Speakeasy syncs samples via OpenAPI overlays. Both ship llms.txt/MCP/AI-search. **Fern was acquired by Postman, announced January 8, 2026** (~200 customers including Square, Auth0, Adobe, Twilio, ElevenLabs). **Verdict: ADAPT the "multi-language code samples from one source of truth" concept** — but SDK generation itself is out of scope.

### kapa.ai / Inkeep

- **Ask-AI widget + Coverage Gaps analytics.** Answers only from sources, cites them, says "I don't know," and — critically — **clusters uncertain/unanswered questions into a documentation backlog** ("Finding" + "Recommendation" per cluster; Common Questions needs ~150 conversations/period, Coverage Gaps focuses on uncertain answers). Hosted MCP for Claude Code/Cursor/Codex; Slack/Discord bot; support-form deflector. **Verdict: ADOPT the Coverage-Gaps concept in a local-first form** — one of the highest-value, most-defensible ideas in the market; maps perfectly onto docstube's feedback categorizer.

### OSS site generators (Docusaurus, Starlight, Nextra, Fumadocs, VitePress, MkDocs Material)

- These are what docstube's _output_ competes with. Their most-upvoted, longest-standing pains reveal what docstube's generated Astro site can nail out-of-the-box: **i18n/multi-language** (the single most-upvoted discussion on MkDocs Material's repo; recurring Starlight requests), **versioning** (Docusaurus's headline feature; scalability concerns for folder-based versioning), **search quality** (federated/unified search across projects), **theme customization without swizzling/CSS hacks that break on upgrade**, and **large-site build performance**. **Verdict:** docstube already ships Pagefind, theme-token editing, and a self-contained Astro site — position these as "the pains you'd otherwise fight in Docusaurus, solved by default."

### OSS AI-docs newcomers

- **OpenDeepWiki (AIDotNet, ~3.3k stars, C#/.NET):** README summaries, wiki catalogs, mind maps, "Graphify," SEO routes, repo-scoped MCP, chat, Feishu/QQ/WeChat/Slack channels.
- **RepoAgent (OpenBMB, ~890-1,000 stars, Python-only, tree-sitter, EMNLP 2024):** pre-commit-hook-driven auto-maintenance, per-function I/O examples, Chat-With-Repo. Roadmap #1: Java/C/C++. Weakness: "lengthy paragraphs," factual drift as complexity rises.
- **deepwiki-rs / "Litho" (sopaco, ~1k stars, Rust):** C4-model Mermaid diagrams, offline/local-first, multi-target-language, ships a "Mermaid Fixer." Roadmap #1: more languages.
- **autodoc (context-labs), gold24park/open-deepwiki (GitHub-Actions-based), kuarcis/deepwiki-open-community (fork merging pending PRs), Azure RepoDocAIAgent (Java), jonverrier/AgentDoc (C4 diagrams for legacy code), Microsoft DocAider (multi-agent, concise bullets vs RepoAgent paragraphs).**
- **Verdict:** The OSS field is fragmented by language/stack (Python-only, .NET, Rust). A local-first TypeScript+Python tool that expands to Java/Go/Rust with _verified, source-grounded_ output and _deterministic_ diagram checking is genuinely differentiated. The recurring "Mermaid Fixer" pattern across these tools validates docstube's choice to verify diagram syntax — and its choice of D2 over Mermaid is defensible on quality grounds, though it costs ecosystem familiarity.

---

## 2. Demand-Signal Findings by theme

**Theme A — "AI docs are shallow slop / genuinely wrong."** The dominant trust complaint. AI docs "read like a hastily composed README … cliches and bad practices" (passo.uno); "technically accurate but contextually empty" and "AI knows generic users"; regeneration "loses human additions." deepwiki-open #230 reports "superficial" analysis with "high overlap across content" and "incorrect hyperlink addresses." **Implication:** docstube's persona-targeted reviewers + verification + feedback-derived writing instructions are the right architecture; lean into "not slop, because it's grounded and gated."

**Theme B — Diagrams: loved-and-hated.** Strong, quotable, polarized. Sentiment splits cleanly by codebase size and reviewer expertise: casual users on small repos praise diagrams as fast orientation; domain experts on large repos (LLVM, LibreOffice) call them wrong and hallucinated. **The clearest single opportunity for docstube.**

**Theme C — Drift/staleness is the core buyer pain.** 28.9% of popular repos document symbols that no longer exist; "engineers have largely stopped reading documentation because docs and reality tend to differ" (Dosu). Every competitor's core pitch. docstube's provenance-based selective regeneration is directly on target.

**Theme D — Lock-in and export.** GitBook post-mortems: proprietary Markdown, no clean export, Git-sync conflicts, no change-notifications. Mintlify: pricing/credit lock-in. **docstube's ejected standard Astro/MDX + MIT core is a direct answer — market it explicitly.**

**Theme E — Provider/model/deploy flexibility.** deepwiki-open issues are dominated by Bedrock/OpenRouter/Voyage/Ollama/DashScope requests, Helm charts, S3, self-hosting. **docstube's BYO-AI already answers the biggest cluster of real user demand in the closest OSS competitor.**

**Theme F — Large-repo/scale failures.** deepwiki-open #468 (context-length crashes on big repos), layered-RAG requests (#447), periodic re-index (#402). **docstube's codemap + symbol-level, affected-pages-only regeneration is architecturally well-suited** — make scale a marketing point, and ensure resumability/caps handle monorepos.

**Theme G — Internal wikis nobody trusts (the monetization audience).** "Confluence hate, Notion staleness" is a known genre; Dosu/kapa target it; teams live in Confluence and want sync, not migration. **Confluence/Notion export or sync is the most-requested integration for the internal-wiki audience.**

**Theme H — llms.txt reality check.** In Ahrefs' June 2026 study of 137,210 domains, ~28% publish an llms.txt (~38,000 domains), but **97% of valid llms.txt files received zero requests in May 2026**; of the ~3% that were read, 19.5% of reads came from named AI tools (GPTBot #1, Claude-Code #2). Google's John Mueller characterizes llms.txt as "not done for search" and "a temporary crutch" for AI coding tools. BUT it's real infrastructure for the _agentic/B2A_ layer, and the dev-tool ecosystem (Mintlify, Fern, Stripe, Anthropic, Cloudflare) has converged on it. **Implication:** keep llms.txt/llms-full.txt (cheap, expected in dev-tools), but don't oversell it as SEO; the higher-value work is serving clean `.md` at doc URLs and the MCP server.

**Theme I — Feedback widgets & search.** ReadMe page voting, GitBook page ratings, "was this helpful?" are table-stakes; users want Ask-AI _and_ fast keyword search, not one or the other. Pagefind + an optional Ask-AI layer is the right combination.

---

## 3. Proposal Lists

### 3A. IMPROVEMENTS to existing planned features

| #   | Proposal                                                                                                                                   | Evidence                                               | Effort | Arch fit                   | Wedge impact             | Priority         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ | ------ | -------------------------- | ------------------------ | ---------------- |
| A1  | **Semantic diagram grounding**: every D2 node/edge must resolve to a codemap symbol; flag ungrounded elements                              | DeepWiki diagram backlash                              | M      | Perfect (codemap+verifier) | **Strengthens** — unique | **Must-have v1** |
| A2  | **`docstube diff` / breaking-change detection** in changelog pipeline: symbol-level + OpenAPI diff, `--fail-on-breaking`, PR comment       | Bump.sh `bump diff`, GitBook "no change notifications" | M      | Strong                     | Strengthens              | **Fast-follow**  |
| A3  | **Extend verifiers**: shellcheck for bash, JSON/YAML sample validation, curl-example validation against OpenAPI, terminal-output freshness | Verification is the wedge; competitors verify nothing  | M      | Perfect                    | **Strengthens core**     | **Fast-follow**  |
| A4  | **"Was this helpful?" widget** on generated sites → feedback categorizer                                                                   | ReadMe page voting, GitBook ratings (table-stakes)     | S      | Strong                     | Neutral-positive         | **Fast-follow**  |
| A5  | **Multi-language code samples from one source** (curl/py/ts) for API/snippet pages                                                         | Fern/Speakeasy/Mintlify                                | M      | Strong                     | Strengthens              | Fast-follow      |
| A6  | **MCP server tool names match DeepWiki set** (`read_wiki_structure`/`read_wiki_contents`/`ask_question` aliases) + Streamable HTTP         | DeepWiki de-facto standard                             | S      | Strong                     | Strengthens distribution | **Must-have v1** |
| A7  | **Serve `.md` at every doc URL** + keep llms.txt/llms-full.txt                                                                             | Ecosystem convention; agents work better on md         | S      | Strong                     | Strengthens distribution | **Must-have v1** |
| A8  | **Freshness SLO gate + bypass label** in GitHub Action output, explainable                                                                 | Dosu freshness gate                                    | S      | Strong                     | Strengthens              | Fast-follow      |
| A9  | **`refresh` sub-tasks / templates**: SEO/AEO audit, broken-link sweep, changelog                                                           | Mintlify Workflows templates                           | S      | Strong                     | Neutral                  | Fast-follow      |
| A10 | **"Not auto-maintained" page flag** (draft vs maintained)                                                                                  | Dosu draft/published distinction                       | S      | Strong                     | Neutral                  | Fast-follow      |
| A11 | **Configurable link-ignore list** from day one                                                                                             | Mintlify Discussion #1516 pain                         | S      | Strong                     | Neutral                  | v1               |

### 3B. NEW features with demand evidence

| #   | Proposal                                                                                            | Evidence                                                                                           | Effort | Arch fit                  | Wedge impact                   | Priority                       |
| --- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------ | ------------------------- | ------------------------------ | ------------------------------ |
| B1  | **OpenAPI/AsyncAPI ingestion as first-class source** + verified API reference                       | Central to Mintlify/Fern/Bump/Redocly/Scalar/ReadMe                                                | L      | Strong                    | **Strengthens**                | **Must-have for API audience** |
| B2  | **API try-it playground**                                                                           | Mintlify/Scalar/ReadMe; Perplexity picked Mintlify for it                                          | L      | Medium (needs proxy/edge) | Neutral                        | Fast-follow (after B1)         |
| B3  | **`docstube audit` — free standalone drift report**                                                 | 28.9% dead-symbol stat; Dosu/Swimm/Mintlify monetize drift; nobody offers free deterministic audit | M      | Perfect                   | **Strongly strengthens + GTM** | **Must-have (GTM)**            |
| B4  | **Local-first "docs gaps from questions"** — mine docs-MCP query logs, cluster weak/missing answers | kapa Coverage Gaps                                                                                 | M      | Strong                    | Strengthens                    | Fast-follow                    |
| B5  | **Privacy-respecting docs analytics** (Plausible-style)                                             | Mintlify PostHog analytics; ReadMe doc metrics                                                     | M      | Strong                    | Neutral-positive               | Fast-follow                    |
| B6  | **Change-notification/subscription surface** (RSS/webhook/email)                                    | GitBook's most-cited gap; Bump weekly digest                                                       | S      | Strong                    | Neutral                        | Fast-follow                    |
| B7  | **"Verified by docstube" badge** w/ live drift count                                                | DeepWiki badge auto-refresh                                                                        | S      | Strong                    | **Strengthens + GTM**          | Fast-follow                    |
| B8  | **VS Code extension surface**                                                                       | Swimm IDE plugin praised as core workflow                                                          | M      | Medium                    | Neutral-positive               | Cloud/later                    |
| B9  | **Pre-commit hook** (`docstube check` on changed symbols)                                           | RepoAgent pre-commit model; Swimm CI checks                                                        | S      | Strong                    | Strengthens                    | Fast-follow                    |
| B10 | **PR-preview deployments of the generated site**                                                    | Docusaurus/Read-the-Docs/Fern PR previews                                                          | M      | Medium                    | Neutral                        | Fast-follow                    |
| B11 | **Monorepo multi-project support**                                                                  | Docusaurus projects-plugin + federated-search demand                                               | M      | Strong                    | Neutral                        | Fast-follow                    |
| B12 | **Language expansion: Java → Go → Rust → C# → PHP**                                                 | Tool roadmaps/coverage triangulation                                                               | L each | Strong                    | Strengthens reach              | Staged fast-follow             |
| B13 | **Confluence/Notion export or sync**                                                                | Dosu KB sync; "teams live in Confluence"                                                           | M      | Medium                    | Neutral                        | **Cloud tier**                 |
| B14 | **Embedded Ask-AI widget (BYO-key, edge-function pattern)**                                         | kapa/Inkeep/GitBook/ReadMe all ship it                                                             | L      | Medium                    | Neutral                        | Cloud tier                     |
| B15 | **Slack/Discord bot answering from verified docs**                                                  | Dosu/kapa precedent                                                                                | M      | Medium                    | Neutral                        | Cloud tier                     |

### 3C. IDEAS / positioning / GTM

- **C1. Hosted "drift gallery" + "State of Docs Drift" report** (content marketing built on `docstube audit` across top OSS projects). **Priority: launch alongside B3.**
- **C2. Verification-badge program** (B7) as a light network effect — badges link back and auto-refresh, echoing DeepWiki's badge-driven refresh loop.
- **C3. docstube as a coding-agent skill/plugin** (Claude Code / Cursor / Codex) so agents consult _verified_ docs and the docs-MCP by default. **Priority: fast-follow; strong strategic fit.**
- **C4. Publish an eval/benchmark** ("verified vs. unverified docs" — accuracy, dead-symbol rate, type-check pass rate) as defensible content.
- **C5. Position against lock-in explicitly** — "your docs are standard Astro/MDX in your repo; delete docstube tomorrow and they still build."

---

## 4. Standards / Conventions Checklist for the Generated Site

- ✅ **llms.txt + llms-full.txt** — keep (dev-tool ecosystem expectation), converged format (H1 name, blockquote summary, H2 grouped link lists, one-line descriptions; link to `.md`). Don't oversell as SEO.
- ✅ **Serve clean `.md` at every doc URL** — the highest-value agent-consumption improvement. **Caution:** canonicalize / keep `.md` out of the sitemap to avoid duplicate-content problems.
- ✅ **MCP docs-server** with tool names matching the DeepWiki de-facto set plus docstube-native tools; support **Streamable HTTP** (`/mcp`), SSE deprecating.
- ✅ **Emit and keep-fresh AGENTS.md** — the cross-tool agent-instruction standard originated by OpenAI (Aug 2025), donated to the Linux Foundation's Agentic AI Foundation (Dec 9, 2025), adopted by 60,000+ projects and read natively by Codex, Cursor, Copilot, Gemini CLI, Windsurf, Devin, Jules, VS Code, and others. docstube should _generate_ a command-first AGENTS.md (build/test/lint commands, "definition of done," boundaries) from the codemap and refresh it on drift. Keep CLAUDE.md thin/referencing AGENTS.md.
- ✅ **URL stability / same-host redirects** (agents recover poorly from broken/cross-host redirects).
- ✅ **Source order for tabbed/filtered content** serialized correctly for agents.
- ✅ **schema.org / structured data, sitemap, canonical, OG** — already planned; keep.
- ⚠️ **Arazzo (OpenAPI workflows)** — relevant if OpenAPI lands, as a later enhancement.

---

## 5. Hard-Boundary Items — Demand Evidence (as of this report)

- **Mermaid support** — Swimm, deepwiki-open, deepwiki-rs, Bito all use Mermaid; multiple tools ship "Mermaid Fixer" tooling because LLMs emit invalid Mermaid. docstube's D2 choice trades ecosystem familiarity for quality; the recurring syntax-fixer pattern _validates docstube's verify-diagram-syntax approach_. Demand for Mermaid compatibility is real and worth watching.
- **Versioned docs** — one of Docusaurus's headline features; API-doc tools (Bump.sh branches, Fern version switching) treat it as core. _(Later revised: ships v1.)_
- **Docs i18n / translations** — the single most-upvoted discussion on MkDocs Material's repo; recurring Starlight requests; Fern/Mintlify sell "first-class translated content." _(Later revised: ships v1.)_
- **Migration import** — GitBook's export pain and "one-command migration" pitches show migration friction is a real switching cost. _(Later revised: importers-as-context ship v1.)_
- **Screenshot / video / native-UI capture** — "no screenshots, no workflow detail" is cited as an AI-slop tell; demand exists but out of scope.
- **docstube-operated free hosting** — DeepWiki's free hosting drove its adoption; hosting lowers friction but is deferred.

---

## 6. Caveats on Evidence Quality

- **Language-expansion ordering is triangulated, not polled.** Java/Go are a confident top tier; C#/PHP are softer.
- **Vendor-sourced claims flagged:** Mintlify's "64% more precise / half the tokens / 1.5x faster," kapa's accuracy/deflection figures, and Swimm's Auto-sync efficacy are **vendor self-reported**.
- **Reviewer-expertise bias in diagram sentiment:** the harshest diagram criticism comes from domain experts on large, well-known repos; casual users on small repos are more positive.
- **llms.txt data:** the Ahrefs/SE-Ranking studies measure _AI-search citation_ and crawler hits, not _agentic consumption_ when an agent is explicitly pointed at the file.
- **GitHub star/issue counts** are as-of mid-2026 crawls.
- **Mintlify pricing is in flux** — verify before quoting externally.
- **Some competitor "reviews" cited are from rival vendors** (Ferndesk, Velu, Featurebase, BunnyDesk) and are inherently slanted.
