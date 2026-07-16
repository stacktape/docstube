---
title: "Configuration"
description: "Configure the docstube config family, agents, versions, locales, components, plugins, and comment-preserving edits."
---

# Configuration

`configFileNames` defines the three YAML file names in the config family: `docstube.yml`, `ia.yml`, and `glossary.yaml`.

`loadConfigFamily` reads those files from the repository root. It requires the config and IA files, parses them with `parseDocstubeConfig` and `parseIaFile`, and returns an empty glossary object with version `1` and no terms when the glossary file is absent.

`docstubeConfigSchema` validates the main intent config. It covers document type, project context, personas, sources, agents, versions, locales, theme, site metadata, enabled components, configured plugins, coverage, output directory, telemetry, and reserved screenshot config.

`iaSchema` validates the information architecture. It requires a non-empty tree. `iaNodeSchema` validates each node title and slug, and supports an optional brief, depth budget, page id, and children. Nodes with a brief are page targets; nodes without a brief are grouping nodes.

`glossarySchema` validates terminology data. `glossaryTermSchema` requires a term and definition, and defaults aliases and avoid-list entries to empty arrays.

## Agents

`agentsConfigSchema` validates the agent block. `transportIdSchema` accepts `claude-cli`, `codex-cli`, `google`, `anthropic-api`, `openai-compatible`, and `replay`.

`createTransportFromConfig` maps the validated agent config to the runtime transport. It supplies default models for `claude-cli`, `anthropic-api`, and `replay`; if another transport has no configured model, it raises a config error.

For API transports, `createTransportFromConfig` forwards configured credential environment-variable names and base URLs to the Anthropic or OpenAI-compatible transport constructors. `agentsConfigSchema` validates the credential reference as an environment-variable name.

`agentsConfigSchema` also accepts writer, reviewer, and translator role overrides. The current task-runner construction uses `createTransportFromConfig`, which reads the top-level agent transport and model.

Agent budgets live in `agentsConfigSchema`. Turn and tool-call budgets default to positive integer limits. The optional run-cost cap is read by generate and maintain flows and passed to `createRunCostTracker`.

`FREEZE_MARGIN_RATIO` is `0.85`. `createRunCostTracker` reports `shouldFreeze()` when reported spend reaches the configured cap multiplied by that margin. In generation, the freeze check happens between pages and before translations, not mid-page. Without a cap, `shouldFreeze()` stays false.

## IA Depth

`depthBudgetSchema` accepts `overview`, `standard`, and `deep`.

`iaNodeSchema` validates slugs with a lowercase path-safe pattern made from ASCII letters, digits, and single hyphen-separated segments. `iaSchema` also accepts an optional positive integer page-count target.

## Versions And Locales

`versionsConfigSchema` defaults the current version label to `latest` and the frozen-version list to an empty array. `versionLabelSchema` validates version labels as path-safe strings that start with an ASCII letter or digit.

`localesConfigSchema` defaults the source locale to `en` and target locales to an empty array. `localeCodeSchema` accepts locale codes such as `en` and `pt-BR`.

## Components

The main config schema validates components as an array of non-empty strings. Its schema comment describes the list as enabled MDX components that must exist in the block-type registry.

`registryComponents` exposes the local UI component choices: `Callout`, `CodeBlock`, `CodeGroup`, `Terminal`, `Card`, `CardGrid`, `Steps`, `Tabs`, `FileTree`, `Badge`, `ParamTable`, and `ComparisonTable`.

`builtinComponents` defines the built-in registry component metadata and prop schemas, and `builtinComponentNames` derives the built-in names from those definitions.

## Plugins

The main config schema validates plugins as an array of non-empty strings. Its schema comment describes entries as npm package names or repository-relative paths.

`registerBuiltinPlugins` registers the built-in verifier, TypeScript language, and Python language plugins through the plugin host. `loadConfiguredPlugins` then loads each configured plugin from the config plugin list.

Local plugin specifiers are imported from files under the target repository. Other specifiers are resolved from the target repository's package dependencies. A configured plugin must default-export a value recognized by `isDocstubePlugin`; otherwise `loadConfiguredPlugins` raises a plugin load error.

## Programmatic Edits

`editYamlDocument` uses the `yaml` Document API and serializes the edited document back to text. `setYamlIn` and `editConfigFile` build on that helper.

`updateConfigValues` batches config edits, validates the edited document with `parseDocstubeConfig`, and writes only after validation succeeds.

`writeIaFile` validates the next IA with `iaSchema` before writing. It preserves the document header comment when replacing the IA document; comments inside a replaced IA tree are not preserved by that structural rewrite.