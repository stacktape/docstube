# Agent transports — vendor capability matrix

**Date verified:** 2026-07-12, from primary sources. Referenced by [ARCHITECTURE.md](../../ARCHITECTURE.md) §8.
Vendor flags churn; re-verify before touching transport code (CLAUDE.md rule). The design rule this
matrix feeds: **docstube owns the loop and the tools; vendor CLIs are model+billing transports.**
A vendor breaking its raw mode degrades one transport, never the product.

## Design-relevant conclusions

1. **Claude Code is the reference CLI transport.** `claude -p --output-format stream-json
--input-format stream-json --tools "" --mcp-config <ours> --strict-mcp-config --max-turns N
--system-prompt …` gives: all built-ins off, only our MCP tools visible, full transcript as
   JSONL, multi-turn driving over stdin. Subscription billing through `claude setup-token`
   (`CLAUDE_CODE_OAUTH_TOKEN`) is officially sanctioned for exactly this use (Agent SDK /
   `claude -p` draw from plan limits; per-plan Agent SDK credit program announced 2026-06,
   currently paused). Risk: LOW — all documented surface.
2. **Codex is close but not fully inert.** `codex exec --json` (JSONL events incl. MCP tool
   calls), `--output-schema` for structured output, MCP servers via `config.toml mcp_servers.*`
   (per-server tool allow/deny), `-c key=value` per-invocation config injection.
   `features.shell_tool=false`, `tools.web_search="disabled"`, `--sandbox read-only`,
   `--ignore-user-config` get near-inert, but **`apply_patch` cannot be disabled** → run with
   read-only sandbox in a scratch dir and treat stray patches as discarded. ChatGPT-subscription
   OAuth and `CODEX_API_KEY` both first-class. Official `@openai/codex-sdk` (TS) wraps the CLI.
   Risk: LOW-MEDIUM (fast flag churn; apply_patch residue).
3. **Google split in two.** Gemini CLI personal-OAuth billing **died 2026-06-18** (enterprise
   Code Assist licenses keep it); the OSS repo (Apache-2.0) remains maintained (v0.50.0,
   2026-07-08) and works with **Gemini API keys / Vertex**: `-p`, `--output-format stream-json`,
   MCP via settings.json. **Antigravity `agy`** (proprietary Go binary) has `agy -p`,
   `--headless --approve <policy>`, `ANTIGRAVITY_TOKEN`, MCP via `.agents/mcp_config.json`
   (`serverUrl` key) — but JSON output, tool disabling, and system-prompt override are
   **unverified** (docs unfetchable; secondary sources only). Decision: ship `google` transport
   on gemini-cli + API key now; add `agy` when its headless surface is documentable. Risk: HIGH
   for agy, MEDIUM for gemini-cli (maintenance question).
4. **Direct API mode.** Anthropic: tool use GA with `strict: true` schema validation + SDK Tool
   Runner (`client.beta.messages.toolRunner`) that runs the loop over our tools — the natural
   basis for the `anthropic-api` transport. Current models: `claude-opus-4-8` /
   `claude-sonnet-5` / `claude-haiku-4-5`; adaptive thinking; no `temperature` on Opus 4.7+.
   OpenAI: GPT-5.6 family via Responses API. Ollama: OpenAI-compatible `/v1/chat/completions`
   with `tools` — **tool-calling quality is model-dependent**; make it an eval concern with a
   documented recommended-models list, never a platform guarantee.

## Matrix

|                      | Claude Code                                             | Codex                                        | gemini-cli (OSS)                   | Antigravity `agy`                       |
| -------------------- | ------------------------------------------------------- | -------------------------------------------- | ---------------------------------- | --------------------------------------- |
| Headless invoke      | `claude -p`                                             | `codex exec`                                 | `gemini -p`                        | `agy -p` / `--headless --approve`       |
| Kill built-in tools  | `--tools ""` (full)                                     | shell/web-search off; `apply_patch` stuck on | tools config in settings.json      | unverified                              |
| Custom tools         | `--mcp-config` + `--strict-mcp-config` (exclusive)      | `mcp_servers.*` + allow/deny lists           | MCP in settings.json               | `.agents/mcp_config.json` (`serverUrl`) |
| Transcript           | `stream-json` in/out                                    | `--json` JSONL + `--output-schema`           | `--output-format json/stream-json` | unverified                              |
| Subscription billing | OAuth token, officially supported                       | ChatGPT login, official                      | dead since 2026-06-18              | Google account; throttled free tier     |
| SDK                  | `@anthropic-ai/claude-agent-sdk` (in-process MCP tools) | `@openai/codex-sdk`                          | none                               | none                                    |
| Risk                 | Low                                                     | Low-medium                                   | Medium                             | High                                    |

Unverified (recheck before implementing): `agy` JSON/tool/system-prompt flags; Codex
`-c mcp_servers.*` per-invocation combo (mechanism documented, exact combo not shown);
gemini-cli free-tier longevity.

Sources: code.claude.com/docs/en/cli-reference · code.claude.com/docs/en/agent-sdk/custom-tools ·
support.claude.com/en/articles/15036540 · learn.chatgpt.com/docs (codex noninteractive/cli-reference/config-reference/sdk — moved from developers.openai.com 2026-07) ·
developers.googleblog.com (gemini-cli→antigravity transition) · github.com/google-gemini/gemini-cli ·
docs.ollama.com/api/openai-compatibility

**Update 2026-07-13 (implementation pass):** codex docs moved to learn.chatgpt.com; codex MCP injection implemented via repeated `-c` overrides + `--ignore-user-config` (auth.json untouched, subscription auth intact); gemini transport isolates `~/.gemini` via HOME override, disables built-ins with `tools.core: []`, replaces the system prompt via `GEMINI_SYSTEM_MD`. Needs one live smoke per transport — see transport doc comments for the three remaining assumptions.
