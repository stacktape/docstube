<!--
Variant 12 — "Docs written for your readers — not for an average."
Lead angle: The persona pillar as the spine. You name your audiences (new hire, OSS contributor, API consumer) and a reviewer agent per persona checks every page for the right depth and tone — as a real gate stage, not a setting. Verification and always-current ride along as support.
Tone: Thoughtful, human, a little quietly contrarian. Talks about readers as people, not "users."
Primary persona: Products and libraries with mixed audiences — where one doc has to serve a first-day hire and a senior integrator at once.
Why it might win: It's the least-claimed angle in the whole set and reframes "good docs" as "right docs for this reader," which most generated-docs tools don't even attempt.
Biggest risk: Persona-fit is softer than a compile check; the page has to make it concrete (reviewer-per-persona, gate stage, "too advanced for a new hire" findings) and keep the hard verification spine so it doesn't float into vibes.
-->

## Hero

**H1 —** Docs written for your readers — not for an average.

**Sub —** Generic docs serve a reader who doesn't exist: the average of everyone. docstube doesn't average. You name your audiences, and a reviewer agent stands in for each one, checking every page for the right depth and tone before it ships. It reads your codebase, writes your docs, verifies every claim against the source, and keeps it all in sync. Open source, and it runs on the AI you already pay for.

**Primary CTA —** Name your readers: `npx docstube wizard`

**Secondary CTA —** How persona review works

**Hero visual —** One page, three reviewer lenses stacked beside it: "New hire — needs more setup context," "OSS contributor — link the contributing guide," "API consumer — show the full response type." Each lens has a checkmark once its note is addressed. The same page, judged three ways.

## Why docstube

- **Written for your readers.** You define the audiences — new hire, OSS contributor, API consumer, whoever they are — and each page is reviewed against them, not a faceless average.
- **A reviewer per persona.** Persona review is a gate stage, not a tone setting. A reviewer agent represents each audience and flags pages that are too shallow, too advanced, or pitched at the wrong reader.
- **Verified, not hallucinated.** The right tone is worthless if the facts are wrong, so every claim is grounded in your source and machine-checked before it ships.
- **Always-current.** Change a function and only the pages that depend on it regenerate, so the doc stays right for the reader it was written for.
- **Bring your own AI.** Runs on your existing Claude, Codex, or Gemini subscription, or any compatible API key, with spend caps you set.
- **Open source.** MIT, generates MDX, zero lock-in.

## Use-cases

- **Public docs sites** — one site that lands for a first-time visitor and a senior integrator alike, with Pagefind search, llms.txt, and an MCP server, that you own.
- **Internal docs & wikis** — onboarding that meets a new hire where they are and architecture notes pitched at the engineers who maintain the system, on private repos and your own keys.
- **Better LLM context** — verified llms.txt and llms-full.txt plus an MCP server give your agents checked context, not raw concatenated source.

## How it works

1. Point docstube at your repo. A local web UI wizard opens.
2. Choose the doc type, then define your reader personas — this is the step that shapes everything after it.
3. A writer agent reads your code; a reviewer agent per persona checks audience fit, and a verifier agent checks accuracy.
4. Review the result rendered exactly as it'll look live, and leave feedback on any element.
5. The writer agent refines until each page lands for the readers you named.
6. On every code change, only the affected pages regenerate.

## Why one doc, two readers, is a real problem

A new hire and a senior integrator open the same page with different questions. The hire needs the setup step spelled out; the integrator wants it out of the way and the edge cases up front. Write for one and you lose the other. Write for the average and you lose both.

docstube's answer is to make the audience explicit. Naming your personas isn't a tone slider — it changes who reviews the page. A reviewer agent stands in for each named reader and asks the questions that reader would: *Is this enough context? Is this pitched too high? Did we assume knowledge this reader doesn't have?* Pages that miss go back to the writer. Pages that land for every named audience pass.

## The gate — why it's verified and right

Persona fit is one stage of the gate. Accuracy is the other, and a page has to clear both.

- A reviewer agent per persona checks depth and tone; pages that don't fit their audience don't pass.
- If a code sample doesn't compile, the page doesn't ship — `tsc` for TypeScript, `pyright` for Python.
- Imports resolve against the real package, so phantom functions never reach the reader.
- Broken links, invalid MDX, and malformed D2 diagrams are machine-checked.
- The agent that writes the page isn't the agent that judges it, and no page ships with an open blocker. That's not a policy — it's the build.

Right tone, right reader, right facts — all enforced before it's live.

## Use your existing subscription

docstube runs on the coding agent you already pay for — the official Claude, Codex, or Gemini CLIs — or a direct-API adapter for any OpenAI- or Anthropic-compatible endpoint, including open-weight and self-hosted models. It estimates vendor usage and freezes at the cap you set, with margin, and runs are resumable.

Your source context goes only to the AI provider you already use, on your own credentials — never to docstube's servers.

## Built for the agent era

Agents are a reader too, so the output is agent-ready: llms.txt, llms-full.txt, and a docs-serving MCP server ship with the site, carrying the same verified content your human readers get.

## You own the output

The result is a self-contained Astro + React site, vendored into your repo with no runtime dependency on docstube. Theme it, eject it, host it anywhere. MIT-licensed, no lock-in.

## Footer credit

A small "Generated by docstube" credit ships on by default. Turn it off with `theme.attribution: false`.

## FAQ

**What exactly is a persona here?** A named audience you define — like "new hire," "OSS contributor," or "API consumer." Each one gets a reviewer agent that checks pages for that reader's depth and tone as part of the gate.

**Does adding personas just change the wording?** It changes who judges the page. A persona reviewer can send a page back for being too advanced for a new hire or too shallow for an integrator — it's a review stage, not a prompt tweak.

**Can different sections target different readers?** Yes. You name the audiences that matter for your project, and pages are reviewed for the readers they're meant to serve.

**Does my code leave my machine?** Source context goes only to the AI provider you already use, on your own credentials — never to docstube's servers.

## Final CTA

**Headline —** Stop writing for the average reader. There isn't one.

**CTA —** `npx docstube wizard`

**Microcopy —** Open source. Reviewed for the readers you name — and verified before it ships.
