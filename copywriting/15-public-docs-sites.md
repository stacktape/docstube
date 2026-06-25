<!--
Variant 15 — "Beautiful public docs — verified, and built to be found."
Lead angle: The public-docs-site use-case. SEO/AEO-friendly structure, built-in Pagefind AI search, llms.txt + llms-full.txt + MCP so AI answer engines can surface you, and a beautiful themeable Astro+React site you own and eject. Verification is the credibility hook: public docs that are wrong cost you trust, so the gate matters more in public.
Tone: Outward, product-marketing-aware but still dev-credible. Polished without hype. Specific.
Primary persona: DevRel, library authors, and founders shipping a public docs site who care how it looks and whether people (and AIs) can find it.
Why it might win: It hits the visible payoff (looks expensive, gets found) and backs it with the gate, which most "pretty docs" tools can't claim.
Biggest risk: Drifting into pure marketing fluff; keep mechanisms named. Hard rule: no translations/i18n — out of scope, do not mention.
-->

## Hero

**H1 —** Beautiful public docs — verified, and built to be found.

**Sub —** docstube's agents generate a polished docs site straight from your code: structured for search engines and AI answer engines, with built-in search, llms.txt, and an MCP server out of the box. Every page clears a verification gate before it ships, so what people find is also what's true. Open source, themeable, and yours to host — it runs on the AI you already pay for.

**Primary CTA —** Run the wizard: `npx docstube wizard`

**Secondary CTA —** See a generated site

**Hero visual —** A finished public docs site rendered in a browser frame — clean nav, a code block, a generated API table. A search overlay is open with instant results. Floating beside the page, three small surfaced artifacts: a `llms.txt` file, an `MCP` endpoint badge, and a green "passed the gate" check on the live page. It looks like a hosted platform, not a generated draft.

## Looks expensive, costs you an `npx`

The site docstube generates uses a custom Astro + React theme with hosted-platform polish — the kind of docs experience that usually means a design sprint or a SaaS subscription. It's themeable through design tokens, so you bring it to your brand instead of inheriting a generic template. Two layouts cover most projects: a single documentation tree, or a sectioned site for larger surfaces. You don't trade looks for control.

## Built to be found — by people and by AI

Discovery isn't one channel anymore. docstube ships the structure for both:

- **Search engines.** Clean, semantic page and section structure with stable IDs gives crawlers something coherent to index — SEO that comes from how the site is built, not a plugin bolted on after.
- **AI answer engines.** docstube generates `llms.txt` and `llms-full.txt` and ships a docs-serving MCP server, so the systems that increasingly answer "how do I use this library" can pull verified content instead of guessing from scraped fragments.
- **On-site search.** Built-in Pagefind search ships with the site — fast, client-side, no search service to run or pay for.

## In public, wrong is expensive — so nothing ships unverified

A public docs site is your credibility surface. A code sample that doesn't run or a function that doesn't exist costs you trust in front of everyone. So docstube doesn't publish on faith. Before any page goes out, deterministic checks run, and a model from a different family reviews what the writer produced.

- **If a code sample doesn't compile, the page doesn't ship.** `tsc` for TS/JS, `pyright` for Python.
- **Imports resolve against the real package — phantom functions never reach the reader.**
- **Broken links, invalid MDX, and malformed diagrams are machine-checked,** so your public site doesn't 404 into itself.
- **API tables are pulled from your types, not written by an LLM** — TypeDoc and griffe — so the reference your readers cite matches the code they install.
- **No page ships with an open blocker — not a policy, the build.**

Diagrams are D2, compiled as part of the gate. Pretty and correct aren't a trade-off here.

## It stays right after launch day

Public docs rot the moment the next release ships. docstube keeps a tree-sitter codemap with symbol-level provenance, so when your code changes only the affected pages regenerate. The GitHub Action opens a PR with just the changed pages and the reasons — never a silent push — so your public site tracks your latest release instead of your last big docs push. A drift report shows you where today's docs already disagree with the code.

## Why docstube

- **Beautiful & modern.** A custom Astro + React theme with hosted-platform polish, themeable to your brand.
- **Built to be found.** SEO- and AEO-friendly structure, built-in Pagefind search, llms.txt, and an MCP server.
- **Verified, not hallucinated.** Every factual claim is grounded in your source and machine-checked before it ships.
- **Always-current.** Change a function and only the affected pages regenerate.
- **Bring your own AI.** Runs on your existing Claude, Codex, or Gemini subscription, or any compatible API key, with spend caps you set.
- **Open source.** MIT, generates MDX, zero lock-in.

## How it works

1. Point docstube at your repo. A local web UI wizard opens.
2. Choose the doc type, define your reader personas, add a little context.
3. A writer agent reads your code; reviewer and verifier agents check it for fit and accuracy.
4. Review the result rendered exactly as it'll look live, and leave feedback on any element.
5. The writer agent refines until you're happy.
6. On every code change, only the affected pages regenerate, and the Action PRs the diff.

The wizard asks the minimum, then runs on its own. You steer the brand and the depth; it handles the rest.

## You own the output — host it anywhere

The site is a self-contained Astro + React build, vendored into your repo with no runtime dependency on docstube and no dependency on a hosted service. Eject it, theme it, deploy it to any static host you already use. It's MIT-licensed MDX underneath, so there's no platform to get locked into and no migration to dread later.

## Footer credit

A small "Generated by docstube" credit is on by default. Turn it off whenever you like with `theme.attribution: false`.

## FAQ

**Will it actually look good enough to be our public site?** Yes — that's the point of the custom Astro + React theme. It ships with hosted-platform polish and is themeable to your brand through design tokens.

**How does it help AI assistants find and cite us correctly?** It generates `llms.txt` and `llms-full.txt` and serves a docs MCP, so answer engines pull verified content rather than scraping fragments — and that content cleared the gate before it shipped.

**Do I have to run a search service?** No. Pagefind search is built in and runs client-side. There's nothing extra to host or pay for.

**Where can I host it?** Anywhere that serves static files. The output is self-contained and yours; docstube isn't in the runtime path.

## Final CTA

**Headline —** Ship docs that look expensive and check out true.

**CTA —** `npx docstube wizard`

**Microcopy —** MIT-licensed. Themeable and yours. Nothing ships until it clears the gate.
