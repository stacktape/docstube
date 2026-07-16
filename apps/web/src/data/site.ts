// Single source of truth for docstube marketing copy.
// Every factual claim below is drawn from the approved fact bank and carries an
// attribution. Do not add numbers that are not sourced here.

export const site = {
  name: 'docstube',
  domain: 'docstube.dev',
  tagline: 'Verified, always-current documentation, generated from your code.',
  repo: 'https://github.com/stacktape/docstube',
  install: 'npx docstube wizard',
  waitlist: '#waitlist'
} as const;

export type NavLink = { label: string; href: string };

export const nav: NavLink[] = [
  { label: 'The ladder', href: '#ladder' },
  { label: 'How it works', href: '#how' },
  { label: 'Pricing', href: '#pricing' }
];

// "Runs on the AI you already use" - the AI tools docstube drives, not customer
// logos. `icon` keys into the inline marks rendered by RunsOn.astro.
export const runsOn = [
  { label: 'Claude', note: 'subscription or API', icon: 'claude' },
  { label: 'Codex', note: 'OpenAI CLI', icon: 'openai' },
  { label: 'Gemini', note: 'Google CLI', icon: 'gemini' },
  { label: 'Any OpenAI-compatible API', note: 'custom base URL', icon: 'api' }
];

export const builtWith = ['GitHub', 'Astro', 'MDX', 'TypeScript', 'Python'];

// The four pillars + supporting features.
export const pillars = [
  {
    key: 'verified',
    title: 'Verified, not hallucinated',
    blurb:
      'Every code sample type-checks, every import resolves, every API reference is matched against your real compiler signatures. Anything that can’t be verified ships flagged for review - never silently wrong.'
  },
  {
    key: 'current',
    title: 'Always current',
    blurb:
      'Change one function and only the pages it touches regenerate, tracked at the symbol level. Run it locally or as a GitHub Action that opens a PR with the changed pages and the reasons why.'
  },
  {
    key: 'personas',
    title: 'Written for your readers',
    blurb:
      'Define your reader personas once. A reviewer agent per persona checks every page for the right depth, tone, and audience fit before it ships.'
  },
  {
    key: 'byo',
    title: 'Bring your own AI',
    blurb:
      'Runs on your existing Claude, Codex, or Gemini subscription - or any API key. No token markup, and your source never leaves your machine for a docstube server. Set spend caps you control.'
  }
] as const;

export const features = [
  { title: 'Compiler-extracted API references', note: 'TypeDoc + griffe, matched to real signatures' },
  { title: 'Drift report', note: 'the places where your docs disagree with your code' },
  { title: 'Incremental regeneration', note: 'symbol-level provenance, only affected pages' },
  { title: 'Built for agents', note: 'llms.txt, llms-full.txt, and a docs-serving MCP server' },
  { title: 'Glossary + autolinking', note: 'consistent terms, linked at build time' },
  { title: 'Changelog from git history', note: 'diffs are ground truth' },
  { title: 'D2 diagrams', note: 'rendered and syntax-checked, sketch mode by default' },
  { title: 'SEO + AEO', note: 'sitemaps, canonical URLs, Open Graph, structured data' }
] as const;

// generate -> review -> verify -> ship loop.
export const howItWorks = [
  {
    step: '01',
    title: 'Point it at your repo',
    body: 'Run docstube wizard. A localhost web UI opens. Pick the doc type, define your reader personas, add a little context. From there it runs autonomously.'
  },
  {
    step: '02',
    title: 'A writer agent drafts from source',
    body: 'docstube builds a structural map of your codebase, then a writer agent drafts MDX pages grounded in the actual source - not a vibe of it.'
  },
  {
    step: '03',
    title: 'Reviewers and verifiers check it',
    body: 'Persona reviewers check audience fit. Deterministic verifiers mechanically check samples, imports, links, diagrams, and API references.'
  },
  {
    step: '04',
    title: 'Pages clear the gate - or ship flagged',
    body: 'Each page retries with feedback until it passes, or ships clearly flagged for human review. Then docstube renders a self-contained Astro site you own.'
  },
  {
    step: '05',
    title: 'Stays in sync as you ship',
    body: 'On every code change, only the affected pages regenerate - locally or via a GitHub Action that opens a PR.'
  }
] as const;

// Mechanical checks for the "docs that compile" verifier cascade.
export const verifierChecks = [
  { label: 'MDX compiles + component props valid', status: 'pass' },
  { label: 'TypeScript samples type-check (tsc)', status: 'pass' },
  { label: 'Python samples check (pyright)', status: 'pass' },
  { label: 'Imports + paths resolve', status: 'pass' },
  { label: 'Internal + external links resolve', status: 'pass' },
  { label: 'D2 diagrams render', status: 'pass' },
  { label: 'API references match compiler signatures', status: 'pass' },
  { label: 'Migration guide - needs a human', status: 'flag' }
] as const;

export const useCases = [
  {
    title: 'Public docs sites',
    body: 'Easy-to-follow, SEO- and AEO-optimized docs with built-in search. A self-contained Astro site you fully own.',
    audience: 'OSS maintainers'
  },
  {
    title: 'Internal docs + wikis',
    body: 'Onboard engineers on a codebase that changes weekly. Docs that regenerate from the source instead of rotting in a wiki.',
    audience: 'Engineering teams'
  },
  {
    title: 'Better context for LLMs',
    body: 'Ship llms.txt, llms-full.txt, and a docs-serving MCP server so your own agents read accurate, current context.',
    audience: 'Devtools + API companies'
  }
] as const;

// Pricing: one hero tier (the whole product, free) + two compact future tiers.
// The future tiers deliberately get no CTA buttons — they don't exist yet.
export const pricing = {
  free: {
    name: 'Open source',
    price: 'Free forever',
    tagline: 'Not a free tier of something bigger. The entire product, MIT-licensed.',
    points: [
      'The full pipeline: generate, review, verify, refresh',
      'CLI, local web UI, and the GitHub Action',
      'Every verifier and every feature — nothing gated',
      'A self-contained MDX + Astro site you own, hosted anywhere',
      'Runs on your Claude, Codex, or Gemini — or any API key',
      'Your source never leaves your machine'
    ],
    cta: 'Join the waitlist',
    ctaHref: site.waitlist
  },
  later: [
    {
      name: 'Cloud',
      price: 'Usage-based',
      tagline:
        'For teams with many repos: a cross-repo Ask agent, docs-health across your fleet, SSO and audit. Sells what a single repo can’t have — never the core product.'
    },
    {
      name: 'Enterprise',
      price: 'Custom',
      tagline: 'Everything in Cloud, self-hosted on your infrastructure, with an SLA and hands-on support.'
    }
  ]
} as const;

// Approved fact bank. tone = how confident the source is. Attribute inline.
export const facts = {
  msftCode: {
    stat: '20–30%',
    claim: 'of code at Microsoft is now AI-written',
    source: 'Satya Nadella, LlamaCon, Apr 2025'
  },
  googleCode: {
    stat: 'over 30%',
    claim: 'of new code at Google is AI-generated',
    source: 'Sundar Pichai, Q1 2025 earnings call'
  },
  cognition: {
    stat: '89%',
    claim: 'of Cognition’s own production code is written by its agent',
    source: 'Cognition, May 2026'
  },
  trustFell: {
    stat: '~29%',
    claim: 'developer trust in AI accuracy - down 11 points',
    source: 'Stack Overflow Developer Survey 2025'
  },
  almostRight: {
    stat: '66%',
    claim: 'are frustrated by AI answers that are “almost right, but not quite”',
    source: 'Stack Overflow Developer Survey 2025'
  },
  distrust: {
    stat: '46%',
    claim: 'distrust AI accuracy, vs. 33% who trust it',
    source: 'Stack Overflow Developer Survey 2025'
  },
  searching: {
    stat: '61–63%',
    claim: 'of developers spend 30+ minutes a day just searching for answers',
    source: 'Stack Overflow surveys'
  },
  docsResource: {
    stat: '84%',
    claim: 'name technical documentation their most-used learning resource',
    source: 'Stack Overflow 2024 survey'
  },
  staleSymbols: {
    stat: '28.9%',
    claim: 'of popular repos document code symbols that no longer exist',
    source: 'Tan, Wagner & Treude · Empirical Software Engineering'
  },
  staleYears: {
    stat: '4.7 years',
    claim: 'how long the average outdated doc reference has been wrong',
    source: 'Tan, Wagner & Treude · Empirical Software Engineering'
  },
  reposPerMinute: {
    stat: '~1 / minute',
    claim: 'new repositories are created on GitHub roughly every minute',
    source: 'GitHub Octoverse 2025'
  },
  llmSdks: {
    stat: '1.13M+',
    claim: 'public repositories now import an LLM SDK',
    source: 'GitHub Octoverse 2025'
  }
} as const;
