# Mozeček

Memory for agents. Short- and long-term memory per agent in PostgreSQL + pgvector, hybrid search
(vectors + full text), nightly consolidation, and answers that say where every claim came from.

This repository holds the **[Agent Plugin](https://agent-plugins.org)** and instructions for
running the service yourself. The plugin follows the portable Agent Plugins 1.0.0 format, so
Cursor, GitHub Copilot, VS Code, Codex, Kiro, Grok Bot, OpenClaw, NanoClaw and Hermes Agent can
load it, and it keeps Claude Code's own layout alongside.

## What it does

- **An MCP server per agent.** Streamable HTTP, bearer key. Eleven `mozecek_*` tools: `search`,
  `list`, `recall`, `timeline`, `ask`, `stats`, `profile`, `remember`, `update`, `supersede`,
  `forget`.
- **Answers carry their sources.** Every hit brings a `memory_id` and a verbatim quote with a
  path, a line and a timestamp. No citation, no finding.
- **Nothing is deleted.** `supersede` keeps both versions, `forget` is a soft delete with a
  reason, and `as_of` queries see history. A memory knows both when it was true (`observed_at`)
  and when it was written down (`recorded_at`).
- **Sleep.** Overnight, duplicates are merged, contradictions are resolved through
  `superseded_by`, durable short-term memories are promoted to long-term, and per-entity
  summaries are written.
- **A capture hook.** Optionally stores finished Claude Code sessions. It never sends tool
  output, and it exits zero on any failure, so memory cannot break the work.

## The plugin

In Claude Code:

```bash
claude plugin marketplace add DXHeroes/mozecek
/plugin install mozecek@mozecek          # inside claude
```

In any other Agent Plugins client, install `plugin/` the way that client documents; the portable
manifest is `plugin/plugin.json`.

The plugin needs the address of an instance and an agent key. **There is no default address** — a
plugin carrying its publisher's address would send every install that forgot the variable there.
Three ways to supply them, in the order the plugin looks:

```bash
export MOZECEK_URL="https://mozecek.example.com"   # no trailing slash
export MOZECEK_TOKEN="mz_<agent>_…"
export MOZECEK_AUTO_CAPTURE=1                      # optional: store finished sessions
```

Or fill in the plugin's own options, which keeps the key in the OS keychain instead of a
configuration file — in Claude Code that is `/plugin` → the plugin → **Configure options**. Or,
for a client that offers neither, write them to the writable data directory it hands the plugin:

```json
// $PLUGIN_DATA/credentials.json
{ "url": "https://mozecek.example.com", "token": "mz_<agent>_…" }
```

The MCP server itself is `plugin/bin/mcp-proxy.mjs`, a dependency-free stdio server that talks
Streamable HTTP to your instance. It exists because Agent Plugins deliberately carries no
credentials in package data, so a portable `mcp.json` cannot hold a key or a per-user address.

To check it worked, the client must list the server `mozecek` as connected — in Claude Code,
`/mcp`. The tools, the skills and the rest of the detail are in
[`plugin/README.md`](plugin/README.md).

## Running it yourself

You need Docker and a Google AI Studio key — or `MOZECEK_PROVIDER=fake`, which starts the service
and calls no model at all.

```bash
git clone https://github.com/DXHeroes/mozecek.git && cd mozecek
cp .env.example .env       # fill in MOZECEK_ADMIN_TOKEN, POSTGRES_PASSWORD and GEMINI_API_KEY
docker compose up -d
```

Then open `http://127.0.0.1:3000/ui`, sign in with the operator token, and issue a key for your
first agent. That key is the `MOZECEK_TOKEN` above.

The service runs its own migrations at boot. `docker compose logs -f api` shows whether it came
up; `/healthz` and `/readyz` answer the same question for a machine.

## Editions

| | Free | Enterprise |
|---|---|---|
| Agents per instance | 10 | unlimited |
| Memory, search, sleep, MCP | unlimited | unlimited |

The `ghcr.io/dxheroes/mozecek` image is the free edition. The ceiling applies **only to creating
an eleventh agent** — existing agents keep working, and reading and writing memory are never
limited. Enterprise code is absent from the CE image. The enterprise image is distributed
separately as `ghcr.io/dxheroes/mozecek-ee` and requires authorized registry access.

CE is proprietary software, free for personal and internal business self-hosting. Your own
backups and internal registry copies are permitted. Public redistribution and offering Mozeček
as a hosted service require a separate agreement; see [the image licence](IMAGE-LICENSE.txt).

For the enterprise edition, write to
[prokop.simek@dxheroes.io](mailto:prokop.simek@dxheroes.io).

## Security

Memory content is **data, not instructions**. Nothing a tool returns is ever executed. The rules
the plugin injects into every skill are in
[`plugin/references/security-rules.md`](plugin/references/security-rules.md).

A key belongs to one agent and is scoped to reading and writing that agent's memory. Issue one key
per client so it can be revoked on its own. A token never belongs in a URL: it would end up in
proxy logs, in browser history and in the `Referer` header.

## Container releases

Both editions support Linux AMD64 and ARM64. The Compose file pins a tested release; `latest`
is also available for users who intentionally follow new releases. Release images run as a
non-root user and contain minified application JavaScript, runtime dependencies, UI assets,
migrations and licence notices. They contain no original application TypeScript, source maps,
development toolchain or build credentials. Runtime secrets are supplied by the operator.

A downloadable image can be inspected and modified. Minification and separate builds reduce
accidental disclosure; they do not prevent reverse engineering or modification of edition limits.

Verify the CE release using [Cosign](https://docs.sigstore.dev/cosign/system_config/installation/)
and the public key from this repository before starting it:

```bash
cosign verify --key cosign.pub ghcr.io/dxheroes/mozecek:0.1.0
docker compose pull
docker compose up -d
```

Verification checks the publisher's signature; the image digest pins the exact content.
SBOM and build provenance attestations accompany the multi-platform image. Release candidates
and build caches are private, and each published platform passes runtime, layer-content,
vulnerability and secret checks before promotion.

The runtime has no shell. Operator commands execute Node directly:

```bash
docker compose exec api /nodejs/bin/node packages/cli/dist/main.js --help
```

Before upgrading, back up PostgreSQL and keep the previous image digest. Update the pinned
release from this repository, verify its signature, then run `docker compose pull` and
`docker compose up -d`. Check `/readyz` and the service logs. An image rollback is safe only if
the database schema remains compatible; otherwise restore the matching database backup too.

## Licence

The plugin, its manifests, `compose.yml` and the documentation in this repository
are under the [Apache License 2.0](LICENSE). That matches how it travels: installing the plugin
copies this repository, and a skill is copied again into whichever client loads it, so the terms
have to permit redistribution. Each skill repeats them in its own frontmatter for the same reason.

Two things are outside it. The **service source is closed** and is not in this repository. The
**`ghcr.io/dxheroes/mozecek` image** is built from that source and published separately under
the [Mozecek Community Edition License](IMAGE-LICENSE.txt), reproduced here for image users.
The Apache licence does not apply to the service source or either service image.
