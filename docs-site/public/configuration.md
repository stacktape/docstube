---
title: "Configuration"
description: "Configure the docstube config family, agents, versions, locales, components, plugins, and comment-preserving edits."
---

# Configuration

`configFileNames` defines the config family file names: `docstube.yml`, `ia.yml`, and `glossary.yaml`.

`loadConfigFamily` reads the files from the repository root. It requires `docstube.yml` and `ia.yml`, parses them with `parseDocstubeConfig` and `parseIaFile`, and returns an empty glossary with `schemaVersion: 1` and `terms: []` when `glossary.yaml` is absent.

## `docstube.yml`

`docstubeConfigSchema` validates the main intent config. The schema covers document type, project context, personas, sources, agents, versions, locales, theme, site metadata, enabled components, configured plugins, coverage, output directory, telemetry, and reserved screenshot config.

The scaffold path writes the raw seed input rather than an expanded defaults object, so first-run `docstube.yml` records chosen intent instead of every defaulted field.

## `ia.yml`

`iaSchema` validates the information architecture. It requires `schemaVersion: 1` and a non-empty `tree`.

`iaNodeSchema` validates each node title and slug. A node can also carry a page brief, depth budget, page id, and child nodes. Nodes with a `brief` are page targets; nodes without a `brief` are grouping nodes.

`depthBudgetSchema` accepts `overview`, `standard`, and `deep`. `iaSchema` also accepts an optional positive integer page-count target.

## `glossary.yaml`

`glossarySchema` validates terminology data. It requires `schemaVersion: 1` and defaults `terms` to an empty array.

Each glossary term requires a term and definition. Aliases and avoid-list entries default to empty arrays.

## Agents

`agentsConfigSchema` validates the agent block. `transportIdSchema` accepts `claude-cli`, `codex-cli`, `anthropic-api`, and `openai-compatible` in `docstube.yml`.

`createTransportFromConfig` builds the runtime transport from the validated config. It supplies default models for `claude-cli` and `anthropic-api`; transports without a default model require an explicit configured model.

API transports receive the configured base URL and credential environment-variable reference from the agent config. The schema validates the credential reference with an uppercase environment-variable-name pattern.

`reviewModel` is optional. `createTaskRunnerFromConfig` uses it for `review-page` tasks and otherwise uses the primary model.

Agent budgets are part of `agentsConfigSchema`. They default to:

- `maxRunUsd: 20`
- `maxTurnsPerTask: 24`
- `maxToolCallsPerTask: 64`

`createRunCostTracker` freezes a capped run when reported plus estimated spend reaches `FREEZE_MARGIN_RATIO`, which is `0.85`, multiplied by the configured run cap. `freezeReason` reports that freeze as reaching 85% of the cap. The run-cost code tracks vendor-reported spend separately from token-derived estimates.

## Versions And Locales

`versionsConfigSchema` defaults the current version label to `latest` and the frozen-version list to an empty array. `versionLabelSchema` validates path-safe labels such as `1.x`, `v2`, and `2026-06`.

`localesConfigSchema` defaults the source locale to `en` and target locales to an empty array. `localeCodeSchema` accepts the supported locale-code shape shown in its message, such as `en`, `pt-BR`, and `zh-Hans`.

## Components

The main config schema validates `components` as an array of non-empty strings. Its schema comment describes the list as enabled MDX components that must exist in the block-type registry.

`registryComponents` exposes the local UI choices: `Callout`, `CodeBlock`, `CodeGroup`, `Terminal`, `Card`, `CardGrid`, `Steps`, `Tabs`, `FileTree`, `Badge`, `ParamTable`, and `ComparisonTable`.

`builtinComponents` defines the built-in component metadata and prop schemas. `builtinComponentNames` is derived from those definitions.

## Plugins

The main config schema validates `plugins` as an array of non-empty strings. Its schema comment describes entries as npm package names or repository-relative paths.

`registerBuiltinPlugins` registers the built-in verifier, TypeScript language, and Python language plugins through the plugin host. `loadConfiguredPlugins` then loads each configured plugin from the config plugin list.

Local plugin specifiers are imported from files under the target repository. Other specifiers are resolved from the target repository's package dependencies. A configured plugin must default-export a value recognized by `isDocstubePlugin`; otherwise `loadConfiguredPlugins` raises a plugin load error.

## Programmatic Edits

`editYamlDocument` uses the `yaml` Document API and serializes the edited document back to text. `setYamlIn` and `editConfigFile` build on that helper.

`updateConfigValues` batches config edits, validates the edited document with `parseDocstubeConfig`, and writes only after validation succeeds.

`writeIaFile` validates the next IA with `iaSchema` before writing. It preserves the document header comment when replacing the IA document; comments inside a replaced IA tree are not preserved by that structural rewrite.