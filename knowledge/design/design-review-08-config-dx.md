## Design problems

The central DX problem is that docstube exposes its internal architecture—pipeline modes, config partitions, block registries, transport mechanics—before delivering a coherent “set up → generate → inspect → deploy → maintain” journey.

1. **The first-run wizard cannot bootstrap itself — fundamental**

   **Why:** `docstube wizard` opens the Dashboard tab, not the wizard, so a new user first sees “No runs yet—start one with `docstube generate`.” [app.tsx](/C:/Projects/docstube/apps/local-ui/src/app.tsx:20) [dashboard.tsx](/C:/Projects/docstube/apps/local-ui/src/dashboard.tsx:64) Once inside the wizard, its paid AI actions are circular: the injected task runner and codemap provider load `docstube.yml`, while first-run scaffolding does not write that file until step 10. Therefore IA proposal and theme extraction cannot work during the first-run flow they are designed for. [wizard-command.ts](/C:/Projects/docstube/apps/cli/src/commands/wizard-command.ts:52) [trpc-router.ts](/C:/Projects/docstube/packages/core/src/server/trpc-router.ts:406) [wizard-step-start.tsx](/C:/Projects/docstube/apps/local-ui/src/wizard-step-start.tsx:38)

   The final action launches `runGenerate` in the background, but unlike the CLI generate command it does not run site emission. [wizard-command.ts](/C:/Projects/docstube/apps/cli/src/commands/wizard-command.ts:72) [generate-command.ts](/C:/Projects/docstube/apps/cli/src/commands/generate-command.ts:42) The wizard can therefore finish without producing the self-contained site users believe they started generating.

   **Better design:** Introduce a first-class onboarding-session model. It should hold autosaved draft intent, detected project data, and temporary agent settings without requiring valid committed config. Agent-backed setup operations must accept that draft directly. On first launch, open the browser and route directly to setup. “Generate” should atomically preflight, commit config, run the pipeline, emit/build the site, and land on its live preview. If interrupted, reopening the wizard should resume the draft or run.

   **Cost:** Moderate now: mainly control-plane inputs, routing, draft persistence, and moving emission into the shared orchestrator. After 0.1.0, changing scaffold timing and run semantics will be much more expensive because users will have workarounds, partially written configs, and automation built around the broken split.

2. **AI provider, credentials, and spend are absent from setup — fundamental**

   **Why:** The schema silently defaults to `claude-cli`, `sonnet`, a nominal `$20` run cap, 24 turns, and 64 tool calls per task. [config-schema.ts](/C:/Projects/docstube/packages/contracts/src/config-schema.ts:39) The wizard neither displays nor writes any `agents` settings. [wizard-state.ts](/C:/Projects/docstube/apps/local-ui/src/wizard-state.ts:338) A Codex user cannot select Codex, and `codex-cli` later requires an explicit model that the wizard has no way to collect. [task-runner.ts](/C:/Projects/docstube/packages/core/src/pipeline/task-runner.ts:64)

   This is also the only wizard choice with direct financial consequences, yet it is omitted while users are asked about favicon paths and MDX components. Preselected personas each imply review work; target locales multiply translation work; retries multiply it again. The user gets no estimate or explanation before “Create config & start generating.”

   `maxRunUsd` is also the wrong universal abstraction: an API user has monetary cost, a subscription user has plan-window usage, and an Ollama user may have no monetary cost at all. Applying a conservative dollar estimate to all three creates misleading freezes.

   **Better design:** Make “Agent & budget” the second setup phase. Detect installed CLIs and relevant credential environment variables, show only viable choices, test the selected transport before generation, and require an explicit model or versioned provider preset. Show an estimated work plan—pages × writers/reviewers × locales × expected retries—and a transport-appropriate limit: dollars for API billing, plan percentage for subscriptions, tokens/time for local models. Hide per-task turn/tool limits under advanced settings.

   **Cost:** Moderate now. After release this becomes a config migration plus a billing-expectation change; unexpected charges or unexplained freezes would create disproportionate trust damage.

3. **There is no journey from generated files to a deployed, maintained site — fundamental**

   **Why:** The product promises GitHub Pages, Vercel, Netlify, PR previews, and deployment plugins, but the CLI has no deploy, publish, or Action-setup command, and the config has no selected deployment target. [PRODUCT.md](/C:/Projects/docstube/PRODUCT.md:207) [cli.ts](/C:/Projects/docstube/apps/cli/src/cli.ts:324) The plugin API only defines a deploy target’s scaffolding hook; nothing in onboarding selects or invokes one. [hook-types.ts](/C:/Projects/docstube/packages/plugin-sdk/src/hook-types.ts:146)

   Generation stops with “build it with npm install && npm run build.” [generate-command.ts](/C:/Projects/docstube/apps/cli/src/commands/generate-command.ts:52) The wizard does not collect `site.baseUrl`, despite deployment needing it for canonical URLs, sitemaps, robots, and social metadata. It also does not scaffold the GitHub Action or explain that successful refresh PRs auto-merge.

   **Better design:** Add a post-generation “Ship” phase backed by `docstube deploy setup`. Offer one opinionated recommended path first—probably GitHub Pages for OSS—with Vercel, Netlify, and “export only” alternatives. It should derive or collect the production URL, scaffold and validate the workflow, explain secrets and auto-merge policy, and perform a local production build before declaring success. The dashboard should finish with a deployment URL or an explicit “generated only; not deployed” state.

   If deployment adapters will not actually ship in 0.1.0, narrow the public promise rather than leaving a contract-shaped dead end.

   **Cost:** High but contained now. After release, deployment conventions, workflow permissions, URLs, and auto-merge behavior become difficult public contracts to reverse.

4. **The public config accepts controls that do not deliver their advertised behavior — fundamental**

   **Why:** Several fields are speculative rather than operational:

   - `autonomy.default.mode: review` is accepted even though the schema explicitly says v1 ignores it and always uses hardcoded policy. This is a dangerous false safety control. [config-schema.ts](/C:/Projects/docstube/packages/contracts/src/config-schema.ts:129)
   - `telemetry.enabled` is accepted, but runtime telemetry reads per-user state and environment variables, not project config. [config-schema.ts](/C:/Projects/docstube/packages/contracts/src/config-schema.ts:173) [runtime-telemetry.ts](/C:/Projects/docstube/apps/cli/src/runtime-telemetry.ts:79)
   - Per-role transport/model overrides are accepted, but the task runner uses the top-level transport and only the separate `reviewModel` shortcut. [config-schema.ts](/C:/Projects/docstube/packages/contracts/src/config-schema.ts:55) [task-runner.ts](/C:/Projects/docstube/packages/core/src/pipeline/task-runner.ts:127)
   - OpenAPI, AsyncAPI, and importer settings are collected, but the built-in plugin registration contains no content-source or importer implementation and the generation pipeline does not consume those config values. [load-plugins.ts](/C:/Projects/docstube/packages/core/src/plugins/load-plugins.ts:12)
   - `screenshots` is an untyped reserved field for an explicitly deferred feature. [config-schema.ts](/C:/Projects/docstube/packages/contracts/src/config-schema.ts:174)

   Strict validation makes this worse: acceptance looks like a guarantee that the setting works.

   **Better design:** The 0.1 schema should contain only enforced behavior. Remove reserved fields until their implementation ships; schema versioning is the reservation mechanism. Add a contract test for every public option: changing it must cause an observable downstream behavior change. In particular, either implement `autonomy.mode: review` and project telemetry opt-out or reject those fields with an explicit “not supported in 0.1” message.

   **Cost:** Low to moderate now—mostly removing or wiring fields. After publication, removing accepted keys is breaking, while leaving them creates privacy and auto-merge trust failures.

5. **The command vocabulary makes users choose pipeline invalidation semantics — significant**

   **Why:** `generate`, `refresh`, and `refine` are implementation modes, not user goals. The distinction is especially costly: refresh refuses new IA pages and tells the user to run generate, while generate walks every page. [maintain.ts](/C:/Projects/docstube/packages/core/src/pipeline/maintain.ts:367) [generate.ts](/C:/Projects/docstube/packages/core/src/pipeline/generate.ts:219) A user adding one page must understand internal ownership boundaries to choose the expensive correct verb.

   `refine --failed` actually means pages with open flags, while output elsewhere consistently uses “flagged.” `check` means deterministic verification, even though verification is the product’s central vocabulary. `validate`, `check`, and `doctor` are three overlapping health verbs with no obvious boundary to a newcomer. `answer` is really an operation on the flag queue.

   **Better design:** Center the surface on lifecycle goals:

   - `docstube setup` — configure or edit; keep `wizard` as an alias.
   - `docstube sync` — automatically bootstrap, add pages, incrementally refresh affected pages, and emit the site; `--all` forces full regeneration.
   - `docstube improve [page]` or `fix [page] --flags` — optional quality work.
   - `docstube verify` — generated-site verification; keep `audit` for foreign docs.
   - `docstube preview`, `deploy setup`, `status`, and `doctor`.

   Move config-only validation under `docstube config validate`, and flag operations under `docstube flags`. Preserve old commands as deprecated aliases through 0.x.

   **Cost:** Moderate now. After 0.1.0, CI workflows, tutorials, shell history, and the GitHub Action will freeze the existing vocabulary.

6. **The ten-step wizard is organized around storage fields, not user decisions — significant**

   **Why:** The wizard gives equal weight to core intent and low-value implementation choices. It asks separately about versions, raw theme tokens, metadata paths, and twelve MDX component types. [wizard-state.ts](/C:/Projects/docstube/apps/local-ui/src/wizard-state.ts:215) All components are preselected anyway, making that entire step mostly ceremonial. [wizard-state.ts](/C:/Projects/docstube/apps/local-ui/src/wizard-state.ts:275) Versions default to `latest`, frozen versions are read-only, and most first-time projects do not need versioning yet. [wizard-steps.tsx](/C:/Projects/docstube/apps/local-ui/src/wizard-steps.tsx:269) Theme setup exposes CSS-token names before the user has seen a real page, and the wizard always commits the `basic` theme despite three built-in themes existing. [wizard-step-theme.tsx](/C:/Projects/docstube/apps/local-ui/src/wizard-step-theme.tsx:53) [wizard-state.ts](/C:/Projects/docstube/apps/local-ui/src/wizard-state.ts:383)

   Meanwhile, provider, cost, layout, base URL, deployment, coverage behavior, and auto-merge are absent.

   **Better design:** Replace ten fixed steps with four adaptive phases:

   1. **Scope:** confirm detected project, sources, public/internal destination, and primary audience.
   2. **Agent & budget:** select and preflight the provider and approve the work plan.
   3. **Docs plan:** show one recommended editable IA, with alternatives on demand.
   4. **Generate, preview, ship:** stream real output, adjust branding in context, then deploy.

   Hide components, versions, locales, advanced token overrides, and role-specific models behind progressive disclosure. Skip sections that require no decision.

   **Cost:** Technically moderate and mostly UI-local now. After release the technical cost remains manageable, but changing the founder’s canonical onboarding story becomes materially harder.

7. **`docType` conflates visibility, product shape, audience, and coverage policy — significant**

   **Why:** One enum—`internal`, `external-library`, or `external-product`—drives persona templates, IA proposals, and whether coverage is enabled. [config-schema.ts](/C:/Projects/docstube/packages/contracts/src/config-schema.ts:8) The detector treats any private npm package as internal documentation. [manifest-signals.ts](/C:/Projects/docstube/packages/core/src/detect/manifest-signals.ts:65) Most commercial product repositories are private while their documentation is public, so this is not an “unambiguous” signal. It also cannot represent a monorepo containing a public SDK, a CLI, an internal service, and operator docs.

   The suggested personas are generic and preselected in pairs, even though each persona is supposed to drive additional review work. [personas.ts](/C:/Projects/docstube/packages/core/src/detect/personas.ts:6)

   **Better design:** Separate:

   - `visibility: public | internal`
   - `productKind: library | cli | service | application | mixed`
   - explicit or explained `coverage` policy
   - a primary audience brief, with optional secondary audiences

   Treat repository signals as evidence with a visible rationale—“private npm package detected”—not as an audience decision. Generate persona IDs from human labels; do not make users maintain slug-like implementation identifiers.

   **Cost:** Moderate now. After release it requires config migration and changes the generated IA/reviewer fan-out for existing projects.

8. **`ia.yml` encodes too many hidden semantics in a hand-edited tree — significant**

   **Why:** A node becomes a page merely by having a `brief`; the absence of that field silently changes it into a grouping node. The same object also carries navigation, URL slug, prompt text, a vague depth budget, an optional opaque `pageId`, and children. [ia-schema.ts](/C:/Projects/docstube/packages/contracts/src/ia-schema.ts:11) The UI has to explain “leave empty for a pure grouping node,” which is evidence that the type distinction is not self-evident. [ia-editor.tsx](/C:/Projects/docstube/apps/local-ui/src/ia-editor.tsx:85)

   Slugs are globally unique even in a nested tree because emitted routes are flat, so a user-visible hierarchy does not imply hierarchical URLs. [ia-schema.ts](/C:/Projects/docstube/packages/contracts/src/ia-schema.ts:42) `overview`, `standard`, and `deep` are exposed despite the architecture still saying the depth policy needs a full specification. [ARCHITECTURE.md](/C:/Projects/docstube/ARCHITECTURE.md:365)

   **Better design:** Use explicit discriminated nodes:

   - `kind: section` with a title and children.
   - `kind: page` with a stable human-readable key, title, optional path override, purpose, audience, and depth.

   Keep opaque entity IDs in the manifest. Derive slugs until manually overridden. Either make tree nesting determine URL paths or display the full resulting URL beside every node. Define depth in observable terms—approximate length, example count, and required detail—not unexplained adjectives. Allow a compact string shorthand for simple hand-edited pages.

   **Cost:** High now because identity and manifest matching must move together, but much higher after users commit IA files and attach durable feedback to the resulting page identities.

9. **The hand-editing contract is stronger in the specification than in the implementation — significant**

   **Why:** The product promises editor autocomplete, human-readable validation, and comment-preserving round trips across the config family. [PRODUCT.md](/C:/Projects/docstube/PRODUCT.md:164) In practice:

   - IA edits replace the whole document and explicitly discard per-node comments. [write-config.ts](/C:/Projects/docstube/packages/core/src/config/write-config.ts:57)
   - Validation reports a logical path but not YAML line/column, source excerpt, or suggested correction. [config-io.ts](/C:/Projects/docstube/packages/core/src/config/config-io.ts:20)
   - JSON Schemas exist only as runtime-generating functions; there is no shipped artifact or SchemaStore registration workflow in the repository. [config-json-schema.ts](/C:/Projects/docstube/packages/contracts/src/config-json-schema.ts:6)
   - The wizard deliberately omits most defaults, so upgrades can change behavior invisibly. Only the theme name is treated as “sticky,” although agent choice, cost limits, footer credit, components, and output behavior are at least as consequential. [wizard-state.ts](/C:/Projects/docstube/apps/local-ui/src/wizard-state.ts:370)

   **Better design:** Ship versioned schema files and registration metadata as release artifacts, with descriptions and examples for every public property. Render validation as `file:line:column`, expected value, received value, likely typo, and a direct fix. Patch IA nodes through keyed YAML-AST operations rather than rebuilding the tree. Write cost-, safety-, and output-affecting defaults explicitly at scaffold time, or store a resolved-settings snapshot in the committed manifest. Define config migrations before the first public schema ships.

   **Cost:** Moderate now. After release, comments already lost cannot be recovered, and changing implicit defaults becomes a backward-compatibility problem.

10. **Preview/build contradicts the no-Node distribution story — significant**

   **Why:** The standalone binary is presented as the no-Node path, but `docstube preview` shells out to `npm install` and `npm run build` inside the generated site. [preview-command.ts](/C:/Projects/docstube/apps/cli/src/commands/preview-command.ts:125) Generation tells every user to do the same, regardless of their package manager. A standalone-binary user may therefore generate source but be unable to preview or produce deployable static output.

   Running `npm install` inside a committed generated directory also creates network latency and can introduce lockfile or dependency drift after verification.

   **Better design:** Make assemble produce both ejectable source and a production static artifact using toolchain versions bundled or tightly owned by docstube. `preview` should serve that same artifact without installing anything. Deployment adapters should deploy it directly. If bundling the build is infeasible, emit a pinned lockfile, select the detected package manager, perform the build during generation, and explicitly state that the standalone path still requires Node for site building.

   **Cost:** Moderate to high now. After release, generated-site layout and hosting adapters will depend on whichever artifact boundary ships first.

11. **Error handling diagnoses components, not user recovery — significant**

   **Why:** The wizard converts every config-family error—not just missing config—into `null`, so invalid existing config is misrepresented as first-run setup and only fails at the final overwrite attempt. [wizard.tsx](/C:/Projects/docstube/apps/local-ui/src/wizard.tsx:41) `doctor` then truncates config errors to the first line, discarding the useful field-level issues. [doctor-command.ts](/C:/Projects/docstube/apps/cli/src/commands/doctor-command.ts:89)

   CLI help is also a manually maintained second description of the command registry. [cli-help.ts](/C:/Projects/docstube/apps/cli/src/cli-help.ts:1) This has already allowed the specification’s `--fresh` flags and the actual CLI surface to diverge. [PRODUCT.md](/C:/Projects/docstube/PRODUCT.md:230)

   **Better design:** Introduce one error renderer shared by CLI and UI: stable code, concise title, source location, cause, remediation, retry command, and optional details. Preserve the distinction between missing, invalid, incompatible, and unreadable configuration. Generate all help from one typed command definition and group it by lifecycle. Add a global `--json` result/error envelope for CI.

   **Cost:** Low to moderate now; mostly centralization. After release, scripts and support material will depend on current text and exit behavior.

12. **Glossary feedback is not a closed learning loop — significant**

   **Why:** `glossary.yaml` is optional and silently becomes an empty in-memory glossary when absent. [config-io.ts](/C:/Projects/docstube/packages/core/src/config/config-io.ts:77) Terminology feedback does not update that canonical file; it is appended to `.docstube/glossary/ui-feedback.md` under a header saying it must later be “folded into glossary.yaml.” [feedback.ts](/C:/Projects/docstube/packages/core/src/server/feedback.ts:17) That contradicts the promise that categorized feedback becomes durable shared learning automatically.

   The glossary’s array-of-objects form is also needlessly verbose for hand editing and permits competing entries for the same canonical term. [glossary-schema.ts](/C:/Projects/docstube/packages/contracts/src/glossary-schema.ts:5)

   **Better design:** Make the canonical term the map key and update the typed YAML directly through the comment-preserving editor, with conflict handling when feedback overlaps an existing term. If automatic structured mutation is considered too risky, store a typed pending patch that the next run consumes—not an inert prose inbox. Use one filename convention across the config family.

   **Cost:** Moderate now. After release, users will accumulate terminology in two incompatible stores and generated writing behavior will depend on which one they happened to edit.

## Effectiveness and UX

- The default work fan-out is hidden. Two preselected personas mean multiple reviewer tasks per page; target locales add translation and locale verification; retries can multiply the whole page cost. None of this appears in the final summary.

- IA setup spends agent output on three complete alternative trees when most users need one recommended hybrid structure and perhaps one alternative. Static instant templates plus one AI-recommended plan would reduce latency and discarded output.

- The current documented sequence—wizard, then generate—can repeat work because the wizard already launches generation but does not emit the full site. [README.md](/C:/Projects/docstube/README.md:54)

- `audit` performs one agent extraction task per page. The core has a `maxPages` safeguard, but the CLI does not expose it and does not show an estimate or progress before beginning. [run-audit.ts](/C:/Projects/docstube/packages/core/src/audit/run-audit.ts:68) [cli.ts](/C:/Projects/docstube/apps/cli/src/cli.ts:188)

- “The waiting room is the review room” is not yet true. The dashboard polls every two seconds and shows timelines but no live production preview; the Review tab renders a structural shard mirror rather than the actual prose. [dashboard.tsx](/C:/Projects/docstube/apps/local-ui/src/dashboard.tsx:8) [review.tsx](/C:/Projects/docstube/apps/local-ui/src/review.tsx:7)

- The wizard does not open the browser automatically, while preview does. First contact therefore starts with a telemetry paragraph and a URL the user must manually open.

- Project description is collected twice in slightly different forms: `projectContext` and `site.description`. The latter should default from the former unless the user edits it for search/social presentation.

- Logo, favicon, OpenAPI, AsyncAPI, and importer locations are raw text paths. Detection already scans the repository, so the UI should present detected files with checkboxes and a file picker, normalize Windows paths, and show a preview.

- The component-selection step has almost no decision value when all built-ins are enabled by default. It should appear only when a component requires extra dependencies, permissions, or deliberate stylistic opt-in.

- Versions and locales are presented before first success even though both greatly expand state and cost. Source locale can usually be inferred; frozen versions belong to release management, not initial setup.

## What is genuinely good

- Strict unknown-key rejection and env-var-name-only credentials are the right safety posture.
- Deterministic, no-agent project detection is the right onboarding principle when evidence and confidence are shown honestly.
- Keeping intent in committed, agent-editable files while treating the wizard as one editor must survive the redesign.

## Open questions for the founder

1. Should `docstube`/`docstube setup` auto-open directly into first-run setup, or should the generic four-tab control plane remain the initial surface?

2. Should the wizard preselect an available installed CLI and ask for confirmation, or require an explicit provider/model choice before any AI-backed setup action?

3. Must users approve a work estimate and cap before the first paid run, or is a disclosed default cap sufficient?

4. Should one `sync` command automatically choose bootstrap versus incremental work, or should `generate` and `refresh` remain distinct public concepts?

5. Is 0.1.0 required to deliver one complete deployment path, or should it explicitly stop at a locally built static artifact and defer all deployment claims?

6. Should unsupported future config fields be rejected until implemented, or may the public schema contain reserved fields that currently do nothing?

7. Should the documentation model keep one `docType`, or split visibility, product kind, coverage policy, and audiences into independent settings?

8. Should IA nesting determine URL paths, or should navigation hierarchy and globally flat page paths remain separate?

9. Should stable page identity be a human-readable key committed in `ia.yml`, or remain entirely manifest-managed with a stronger rename-matching mechanism?

10. Should the generated repository contain ejectable source only, or both source and an already-built static artifact so standalone users can preview and deploy without npm?

11. Should setup require explicit confirmation before scaffolding an auto-merging maintenance workflow, or scaffold it enabled by default with a prominent explanation?

12. Should `ia.yml` and `glossary.yaml` remain generic root files, or move under a namespaced committed `.docstube/` config directory referenced by `docstube.yml`?
