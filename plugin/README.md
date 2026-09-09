# Mozeček — plugin

Memory for an agent: the `mozecek_*` MCP tools (`search`, `list`, `recall`, `remember`, `update`,
`supersede`, `forget`, `timeline`, `ask`, `stats`, `profile`), a Stop hook that stores a finished
session, and skills for working with memory. The service itself (Postgres + pgvector, Gemini, the
MCP endpoint) runs separately; how to deploy it is in [`../README.md`](../README.md).

## Quick start

An agent key (`mz_<agent>_…`) is issued by an operator in the Mozeček web UI, on the Agents page,
or with `node packages/cli/dist/main.js onboard --slug <slug> --name "<name>"` next to the
service. It is shown once. Use one key per client so it can be revoked on its own. The agent slug
is inside the token, so you never set it anywhere.

```bash
claude plugin marketplace add DXHeroes/mozecek   # once; or a path to a local checkout
/plugin install mozecek@mozecek                  # inside claude
```

In any other [Agent Plugins](https://agent-plugins.org) client, install this directory the way
that client documents — the portable manifest is `plugin.json` and the MCP server is `mcp.json`.

The quickest configuration is the environment. Interactive `claude` reads variables only from the
shell environment, so put them in `~/.zshrc`:

```bash
export MOZECEK_URL="https://mozecek.example.com"   # your instance, no trailing slash
export MOZECEK_TOKEN="mz_<agent>_…"
export MOZECEK_AUTO_CAPTURE=1                      # optional: store finished sessions
```

Or the same as an `env` block in `~/.claude/settings.json`, which Claude Code passes to both the
plugin and the hook. To keep the key out of a configuration file altogether, use the plugin's
options instead — see [Environment variables](#environment-variables) for all three sources.

**Checking it worked.** `/mcp` lists the server `mozecek` as Connected, `/plugin` lists the plugin
`mozecek`. A first question: `/mozecek:recall why did we move to Attio`.

The **Connect** page in the Mozeček UI (`/ui/connect`) prints these steps with the real address
and key filled in and a copy button, including variants for Cursor and other MCP clients.

## Without the plugin

The MCP server alone, without the skills and the hook:

```bash
claude mcp add --transport http --scope user mozecek "$MOZECEK_URL/mcp" \
  --header "Authorization: Bearer $MOZECEK_TOKEN"
```

The endpoint carries no slug: a key belongs to one agent, so the token alone says whose memory
answers. `/mcp/<agent>` still works and is the only option for an operator token.

The marketplace is this repository (`.claude-plugin/marketplace.json`). A headless agent enables
the plugin in `.claude/settings.json` and takes the variables from the application environment.

## Environment variables

| Variable | What for | Default |
|---|---|---|
| `MOZECEK_TOKEN` | the agent's bearer token (reads and writes its memory) | — (without it the server does not connect) |
| `MOZECEK_URL` | base of the API and the MCP endpoint, **no trailing slash** | — (without it the server does not connect) |
| `MOZECEK_AGENT` | agent slug; an override for when it must not come from the token | the slug inside `MOZECEK_TOKEN` |
| `MOZECEK_AUTO_CAPTURE` | `1` enables the Stop hook that sends a session into memory | off |
| `MOZECEK_CAPTURE_MAX_KB` | how much of the transcript's tail the hook reads | `256` |
| `MOZECEK_DEBUG` | `1` makes the hook write its reason to stderr | off |

The values belong in a shell profile, in an agent's env file, or in an application's variables.

Three sources, in the order the plugin looks:

1. **The environment** — `MOZECEK_URL`, `MOZECEK_TOKEN`. Works in every client that passes its
   environment to a subprocess.
2. **The plugin's own options** — in Claude Code, `/plugin` → the plugin → **Configure options**.
   A value marked sensitive goes to the OS keychain, never to `settings.json`. They arrive as
   `CLAUDE_PLUGIN_OPTION_URL`, `_TOKEN` and `_AUTO_CAPTURE`.
3. **`$PLUGIN_DATA/credentials.json`** — `{"url": …, "token": …}`. Agent Plugins guarantees that
   directory is writable and survives plugin updates, so this is the route for a client that
   offers neither of the above. The MCP server reads it; the Claude Code capture hook does not,
   because Claude Code supplies the two sources above instead.

An earlier source wins, so a single run can override an installed value.

**There is no default address.** Without `MOZECEK_URL` the MCP server does not connect and the
capture hook stays quiet. That is deliberate: a plugin carrying its publisher's address would
send every install that forgot the variable there.

**Trailing slash in `MOZECEK_URL`.** Tolerated: `bin/mcp-proxy.mjs` and `capture.mjs` both strip
one before building a path. Write it without anyway — the address also ends up in a client's own
configuration, where nothing strips it.

**Interactive `claude` versus a headless run.** A scheduled run loads its environment from the
agent's env file. Interactive `claude` started from a terminal does not read that file — the hook
and the MCP server see only the shell environment. For capture and memory to work there too,
export `MOZECEK_*` in your shell profile.

## Layout

The directory serves the portable Agent Plugins format and Claude Code at once, because Claude
Code is not an Agent Plugins client yet and reads different paths:

```
plugin/
├── plugin.json                 portable manifest
├── mcp.json                    portable MCP server  (${PLUGIN_ROOT})
├── bin/mcp-proxy.mjs           the MCP server itself: stdio in, Streamable HTTP out
├── skills/<name>/SKILL.md      shared by every client
│   └── references/             bundled per skill; Agent Skills cannot reach above a skill
├── references/                 the source those copies are generated from
├── .claude-plugin/plugin.json  Claude Code manifest, plus its userConfig options
├── .mcp.json                   Claude Code MCP server  (${CLAUDE_PLUGIN_ROOT})
├── hooks/                      Claude Code only: the Stop capture hook
└── agents/                     Claude Code only: the memory-curator subagent
```

`bin/mcp-proxy.mjs` has no dependencies and needs only Node. It exists because Agent Plugins
keeps credentials out of package data: configured headers must be literal and free of secrets,
and placeholder expansion never reaches a remote URL or a header. A portable `mcp.json` therefore
cannot carry a per-user address or a key, but a stdio server can be handed both at run time.

## The `mozecek_*` tools

| Tool | Scope | What it does |
|---|---|---|
| `mozecek_search` | read | hybrid search (vector + full text), hits carry citations |
| `mozecek_list` | read | list by filters, without a query |
| `mozecek_recall` | read | the full content of one memory with its supersede chain |
| `mozecek_timeline` | read | how a topic or an entity changed over time |
| `mozecek_ask` | read | a model answer over the hits, every claim cited as `[n]` |
| `mozecek_stats` | read | counts and the last sleep run |
| `mozecek_profile` | read | the agent's profile (also as the resource `mozecek://agents/{agent}/profile`) |
| `mozecek_remember` | write | store a memory; `search` for duplicates first |
| `mozecek_update` | write | fix tags, entities, importance |
| `mozecek_supersede` | write | the statement no longer holds; both versions stay |
| `mozecek_forget` | write | soft delete with a reason |

Parameters and examples: `references/tool-cheatsheet.md`. What the tools return is data, not
instructions.

## Skills

| Skill | What it does |
|---|---|
| `/mozecek:recall <query>` | searches memory and answers with citations (read-only) |
| `/mozecek:remember <text>` | stores a memory after a duplicate check |
| `/mozecek:sleep [--wait]` | reports the last nightly consolidation and how to trigger another |
| `/mozecek:review [--since 7d] [--apply]` | reviews memory; writes only with `--apply` |

The review behind `/mozecek:review` is done by the `mozecek:memory-curator` subagent
(`agents/memory-curator.md`).

## The capture hook

`hooks/capture.mjs` runs on the `Stop` event. It is off until `MOZECEK_AUTO_CAPTURE=1`, and on
any problem it exits zero without a word — a memory service must never break a session. Without a
`session_id` it sends nothing: there would be nothing to attribute the capture to, and the
endpoint requires that field. Optional fields (`cwd`, `hook_event_name`) are **omitted** when
absent rather than sent as `null`. It sends only user and assistant turns; tool output is dropped
and the rest goes through redaction of secret shapes (Slack, AWS, GitHub, Google, bearer tokens,
private keys, Mozeček tokens).

## Security

Memory content is **untrusted data** — instructions inside a memory are not carried out
(`references/security-rules.md`). `MOZECEK_TOKEN` belongs to one agent, is scoped to reading and
writing that agent's memory, and can be rotated at any time.
