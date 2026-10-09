---
title: 'Configuration'
description: 'Configure docstube.yml, ia.yml, glossary.yaml, agents, locales, components, and plugins.'
---

# Configuration

<Claim id="c1">`configFileNames.config` is docstube.yml.</Claim> <Claim id="c2">`configFileNames.ia` is ia.yml.</Claim> <Claim id="c3">`configFileNames.glossary` is glossary.yaml.</Claim>

These files are the configuration family a maintainer edits when a repository's documentation intent changes. <Claim id="c4">`loadConfigFamily` reads `docstube.yml` and `ia.yml`.</Claim> <Claim id="c5">`loadConfigFamily` uses an empty glossary when `glossary.yaml` is absent.</Claim>

## Main Config

<Claim id="c6">`docstubeConfigSchema` requires `schemaVersion`.</Claim> <Claim id="c7">`docstubeConfigSchema` requires `docType`.</Claim> <Claim id="c8">`docstubeConfigSchema` requires `personas`.</Claim> <Claim id="c9">`docstubeConfigSchema` requires `site`.</Claim>

The schema is strict: <Claim id="c10">`docstubeConfigSchema` rejects unknown top-level keys.</Claim> Keep `docstube.yml` focused on intent: project context, personas, source hints, agent routing, site metadata, localization, components, plugins, and output policy.

```yaml
schemaVersion: 1
docType: external-product
projectContext: >-
  Short description of what this project is and who the generated docs are for.
personas:
  - id: oss-maintainer
    description: Maintains the repository and reviews generated docs.
sources:
  openapi: []
  asyncapi: []
  imports: []
agents:
  transport: codex-cli
  model: gpt-5.5
  budgets:
    maxRunUsd: 100
    maxTurnsPerTask: 24
    maxToolCallsPerTask: 64
    maxPlanUsagePercent: 80
locales:
  source: en
  targets: []
theme:
  name: basic
site:
  title: My Project
  description: Verified documentation for My Project.
  layout: single-tree
components:
  - Callout
  - CodeBlock
plugins:
  - ./plugins/company-style.ts
```

## Agents

<Claim id="c11">`transportIdSchema` accepts `claude-cli`.</Claim> <Claim id="c12">`transportIdSchema` accepts `codex-cli`.</Claim> <Claim id="c13">`transportIdSchema` accepts `anthropic-api`.</Claim> <Claim id="c14">`transportIdSchema` accepts `openai-compatible`.</Claim>

<Claim id="c15">`agentsConfigSchema.transport` defaults to claude-cli.</Claim> <Claim id="c16">`agentsConfigSchema.baseUrl` is optional.</Claim> <Claim id="c17">`agentsConfigSchema.apiKeyEnv` is optional.</Claim> <Claim id="c18">`agentsConfigSchema.apiKeyEnv` accepts uppercase environment variable names.</Claim>

Role overrides let a maintainer route different work to different models. <Claim id="c19">`agentRolesConfigSchema` defines `writer`.</Claim> <Claim id="c20">`agentRolesConfigSchema` defines `reviewer`.</Claim> <Claim id="c21">`agentRolesConfigSchema` defines `risk-critic`.</Claim> <Claim id="c22">`agentRolesConfigSchema` defines `translator`.</Claim> <Claim id="c23">`agentRolesConfigSchema` defines `architect`.</Claim> <Claim id="c24">`agentRolesConfigSchema` defines `extractor`.</Claim>

<Claim id="c25">`resolveRoleRouting` lets a role inherit the top-level transport.</Claim> <Claim id="c26">`resolveRoleRouting` lets a role inherit the top-level model.</Claim> <Claim id="c27">`resolveRoleRouting` uses the role transport before the top-level transport.</Claim>

## Budgets

<Claim id="c28">`agentsConfigSchema.budgets.maxRunUsd` defaults to 20.</Claim> <Claim id="c29">`agentsConfigSchema.budgets.maxTurnsPerTask` defaults to 24.</Claim> <Claim id="c30">`agentsConfigSchema.budgets.maxToolCallsPerTask` defaults to 64.</Claim> <Claim id="c31">`agentsConfigSchema.budgets.maxPlanUsagePercent` defaults to 80.</Claim>

<Claim id="c32">`FREEZE_MARGIN_RATIO` is 0.85.</Claim> <Claim id="c33">`createRunCostTracker` freezes a run when reported and estimated spend reaches 85 percent of `maxRunUsd` without a plan-usage signal.</Claim> <Claim id="c34">`createRunCostTracker` freezes a run when plan usage reaches `maxPlanUsagePercent`.</Claim> <Claim id="c35">`buildWritePageTask` uses `maxTurnsPerTask` for writer task turns.</Claim> <Claim id="c36">`buildWritePageTask` uses `maxToolCallsPerTask` for writer task tool calls.</Claim>

For maintainers, the practical split is simple: `maxRunUsd` is the run cap, `maxPlanUsagePercent` is the subscription plan cap, and per-task turn and tool-call limits bound individual writer tasks.

## Locales

<Claim id="c37">`localesConfigSchema.source` defaults to en.</Claim> <Claim id="c38">`localesConfigSchema.targets` defaults to an empty array.</Claim> <Claim id="c39">`localeCodeSchema` accepts locale codes like `en`.</Claim> <Claim id="c40">`localeCodeSchema` accepts locale codes like `pt-BR`.</Claim> <Claim id="c41">`localesConfigSchema` rejects a target that equals the source locale.</Claim> <Claim id="c42">`localesConfigSchema` rejects duplicate targets case-insensitively.</Claim>

<Claim id="c43">`loadConfigFamily` rejects an IA page slug that collides with a configured target locale route prefix.</Claim>

## Information Architecture

<Claim id="c44">`iaSchema` requires `schemaVersion`.</Claim> <Claim id="c45">`iaSchema` requires `tree`.</Claim> <Claim id="c46">`iaNodeSchema` requires `title`.</Claim> <Claim id="c47">`iaNodeSchema` requires `slug`.</Claim> <Claim id="c48">`iaNodeSchema` allows `brief`.</Claim> <Claim id="c49">`iaNodeSchema` allows `children`.</Claim> <Claim id="c50">`depthBudgetSchema` accepts `overview`.</Claim> <Claim id="c51">`depthBudgetSchema` accepts `standard`.</Claim> <Claim id="c52">`depthBudgetSchema` accepts `deep`.</Claim>

A node with a `brief` is page intent for the writer, and a node without a `brief` can be used as a grouping node. <Claim id="c53">`iaSchema` rejects duplicate page slugs.</Claim>

## Glossary

<Claim id="c54">`glossarySchema` requires `schemaVersion`.</Claim> <Claim id="c55">`glossarySchema.terms` defaults to an empty array.</Claim> <Claim id="c56">`glossaryTermSchema` requires `term`.</Claim> <Claim id="c57">`glossaryTermSchema` requires `definition`.</Claim> <Claim id="c58">`glossaryTermSchema.aliases` defaults to an empty array.</Claim> <Claim id="c59">`glossaryTermSchema.avoid` defaults to an empty array.</Claim>

Use `glossary.yaml` for terminology the generated pages should treat consistently.

## Components And Plugins

<Claim id="c60">`docstubeConfigSchema.components` defaults to an empty array.</Claim> The component list names enabled MDX components for generated pages.

<Claim id="c61">`docstubeConfigSchema.plugins` defaults to an empty array.</Claim> <Claim id="c62">`loadConfiguredPlugins` loads each configured plugin specifier.</Claim> <Claim id="c63">`loadConfiguredPlugins` treats relative plugin specifiers as local plugins.</Claim> <Claim id="c64">`loadConfiguredPlugins` resolves package plugin specifiers from the target repository.</Claim> <Claim id="c65">`loadConfiguredPlugins` requires a default export created with `definePlugin`.</Claim>

```yaml
plugins:
  - docstube-plugin-wordcount
  - ./plugins/company-style.ts
```

## Programmatic Edits

<Claim id="c66">`editYamlDocument` parses YAML with `parseDocument`.</Claim> <Claim id="c67">`editYamlDocument` serializes YAML with `doc.toString`.</Claim> <Claim id="c68">`updateConfigValues` validates the edited `docstube.yml` before writing it.</Claim> <Claim id="c69">`editConfigFile` validates the edited config-family file before writing it.</Claim> <Claim id="c70">`writeIaFile` preserves a top-of-file comment.</Claim>

That means a maintainer can keep hand-written comments in the config family while using the local UI or wizard for routine edits.
