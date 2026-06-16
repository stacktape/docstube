<div align="center">

# docstube

**Verified, always-current documentation - generated from your code.**

docstube reads your codebase, writes your docs, fact-checks every claim against the source, and keeps everything in sync as your code changes. Open-source, and it runs on the AI you already pay for.

[Website](https://docstube.dev) · [Discussions](../../discussions)

</div>

> [!WARNING]
> **docstube is in early development and not yet released.** There's nothing to install yet. Star and watch the repo to follow along, and join the waitlist at [docstube.dev](https://docstube.dev) for early access.

## What it is

Documentation rots the moment it's written, and generic AI writers make it worse - confident prose that was never tied to your actual code. docstube takes the opposite approach: a small team of AI agents reads your real source, writes each page for the readers you choose, and fact-checks it against the code before anything ships. When your code changes, only the affected pages regenerate.

## Why docstube

- **Verified, not hallucinated** - every factual claim is checked against your source; code samples are compiled and imports resolved.
- **Complete** - nothing important is left undocumented.
- **Written for your readers** - define personas; each page is reviewed for the right depth and tone.
- **Always current** - change your code, and only the affected docs regenerate (locally or via a GitHub Action).
- **Bring your own AI** - runs on your existing Claude, Codex, or Gemini subscription (or an API key), with spend caps you control.
- **Yours to keep** - clean MDX and a beautiful docs site, MIT-licensed, no lock-in.

## How it works (planned)

```bash
# Not available yet - shown to illustrate the intended workflow.
npx docstube wizard
```

1. Point docstube at your repo; a local web UI opens.
2. Choose the doc type, define your reader personas, add a little context.
3. A writer agent reads your code; reviewer and verifier agents check it for fit and accuracy.
4. Review the result as it'll look live, leave feedback on any element, and publish a docs site you own.
5. On every change, only the affected pages regenerate.

## Status & roadmap

docstube is being built in the open. Watch the repo and follow [Discussions](../../discussions) for progress.

- [ ] Core generation pipeline (writer / reviewer / verifier)
- [ ] Local web UI (setup + review)
- [ ] Incremental updates + GitHub Action
- [ ] Docs site renderer (Astro)
- [ ] First public release

## Contributing

Early contributors and ideas are very welcome - see [CONTRIBUTING.md](CONTRIBUTING.md) and start a thread in [Discussions](../../discussions). Please also read the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE) © 2026 Stacktape
