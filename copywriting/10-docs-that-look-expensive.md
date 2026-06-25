<!--
Variant 10 — "Docs that look like you spent months on them."
Lead angle: The Beautiful & modern pillar as hero — a custom Astro + React theme with the polish of the best hosted docs platforms, themeable to your brand, and yours to own and eject. Develops a founder TBD into a real design story, with verification/autonomy kept present as the substance behind the surface.
Tone: Aesthetic, proud, design-forward. Confident about craft without slipping into adjective soup.
Primary persona: Teams who treat docs as part of the product and care about brand + developer experience.
Why it might win: Most "AI docs" output looks like a markdown dump; leading with looks is genuinely uncontested, and the gate lets the page promise substance behind the polish.
Biggest risk: Beauty is subjective and easy to over-claim; the page has to tie looks to real mechanisms (custom theme, tokens, ownership) and keep the verification spine so it doesn't read as style over truth.
-->

## Hero

**H1 —** Docs that look like you spent months on them.

**Sub —** Most generated docs look generated. docstube ships a custom Astro + React theme with the polish of the best hosted docs platforms — and the content underneath is real: it reads your codebase, writes your docs, fact-checks every claim against the source, and keeps everything in sync as your code changes. Themeable to your brand. Yours to own.

**Primary CTA —** Generate a site: `npx docstube wizard`

**Secondary CTA —** See the theme

**Hero visual —** A polished docs page rendered in the docstube theme — generous type, a clean sidebar, a syntax-highlighted code block, a crisp D2 diagram, and instant Pagefind search open over it. A small toggle in the corner flips brand tokens (accent color, font) and the whole page re-skins live. No "default template" feel anywhere.

## Why docstube

- **Beautiful & modern.** A custom Astro + React theme, not a recycled template — the typography, spacing, navigation, and search feel like a product you'd pay a platform for.
- **Themeable to your brand.** Drive the look with design tokens: color, type, density. It matches your product instead of announcing the tool that made it.
- **Verified, not hallucinated.** The polish isn't a coat of paint over guesses — every factual claim is grounded in your source and machine-checked before it ships.
- **Always-current.** Change a function and only the pages that depend on it regenerate, so the site that looks finished stays finished.
- **Written for your readers.** Name your personas; each page is reviewed for the right depth and tone.
- **Open source.** MIT, generates MDX, zero lock-in.

## Use-cases

- **Public docs sites** — a beautiful, SEO- and AEO-friendly site with built-in Pagefind search, llms.txt, and an MCP server, that looks like your brand and that you own.
- **Internal docs & wikis** — onboarding and architecture for private repos that your team actually wants to open, on your own infra and keys.
- **Better LLM context** — verified llms.txt and llms-full.txt plus an MCP server give agents checked context behind the same polished site.

## How it works

1. Point docstube at your repo. A local web UI wizard opens.
2. Choose the doc type, define reader personas, add a little context.
3. A writer agent reads your code; reviewer and verifier agents check it for audience fit and accuracy.
4. Review the result rendered exactly as it'll look live — pixel-accurate — and leave feedback on any element.
5. The writer agent refines until you're happy.
6. On every code change, only the affected pages regenerate.

What you preview is what ships. The wizard renders the real theme, not a draft view.

## The look — and the substance under it

A pretty docs site that's wrong is worse than an ugly one. docstube earns the polish by checking what's inside it.

- The code blocks aren't decoration — if a sample doesn't compile (`tsc` for TypeScript, `pyright` for Python), the page doesn't ship.
- The diagrams are real D2, compiled before they render. Malformed diagrams never reach the reader.
- The API tables are extracted from your types with TypeDoc and griffe, so they're crisp *and* correct — and they update for zero tokens when signatures change.
- Imports resolve against the real package, and internal and external links resolve, so nothing in the beautiful page is a dead end.
- The agent that writes the page isn't the agent that judges it, and no page ships with an open blocker. That's not a policy — it's the build.

## Use your existing subscription

docstube runs on the coding agent you already pay for — the official Claude, Codex, or Gemini CLIs — or a direct-API adapter for any OpenAI- or Anthropic-compatible endpoint, so open-weight and self-hosted models fit as a config matter. It estimates vendor usage and freezes at the cap you set, with margin, and runs are resumable.

Your source context goes only to the AI provider you already use, on your own credentials — never to docstube's servers.

## Built for the agent era

The polish extends to machines: llms.txt, llms-full.txt, and a docs-serving MCP server ship with the site, so agents reading your docs get the same verified content your readers see.

## You own the output

The site is a self-contained Astro + React project, vendored into your repo with no runtime dependency on docstube. Eject the theme and edit it as your own React components, or keep theming it with tokens. Host it anywhere. MIT-licensed, no lock-in — the design is yours, not a rental.

## Footer credit

A small "Generated by docstube" credit ships on by default. If it doesn't fit your brand, set `theme.attribution: false`.

## FAQ

**Is this just a default template everyone will recognize?** No. It's a custom Astro + React theme designed to feel like a hosted platform, and it's themeable with tokens so it carries your brand, not docstube's.

**Can I change the design beyond colors?** Yes. Theme it with tokens for fast brand fit, or eject it and edit the React components directly — it's your code.

**Will it still look good as the code changes?** Yes. Only affected pages regenerate, so the site stays current without losing the finished look.

**Does my code leave my machine?** Source context goes only to the AI provider you already use, on your own credentials — never to docstube's servers.

## Final CTA

**Headline —** Make your docs look like the product they describe.

**CTA —** `npx docstube wizard`

**Microcopy —** Open source. A custom themeable Astro + React theme you own — with verified content underneath.
