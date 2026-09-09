# Mozeček

Memory for agents. Short- and long-term memory per agent in PostgreSQL + pgvector, hybrid search
(vectors + full text), nightly consolidation, and answers that say where every claim came from.

This repository holds the **Claude Code plugin** and instructions for running the service yourself.

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

## The Claude Code plugin

```bash
claude plugin marketplace add DXHeroes/mozecek
/plugin install mozecek@mozecek          # inside claude
```

The plugin needs the address of an instance and an agent key. **There is no default address** — a
plugin carrying its publisher's address would send every install that forgot the variable there:

```bash
export MOZECEK_URL="https://mozecek.example.com"   # no trailing slash
export MOZECEK_TOKEN="mz_<agent>_…"
export MOZECEK_AUTO_CAPTURE=1                      # optional: store finished sessions
```

To check it worked, `/mcp` must list the server `mozecek` as Connected. The tools, the skills and
the rest of the detail are in [`plugin/README.md`](plugin/README.md).

## Running it yourself

You need Docker and a Google AI Studio key — or `MOZECEK_PROVIDER=fake`, which starts the service
and calls no model at all.

```bash
git clone https://github.com/DXHeroes/mozecek.git && cd mozecek
cp .env.example .env       # fill in MOZECEK_ADMIN_TOKEN, POSTGRES_PASSWORD and GEMINI_API_KEY
docker compose up -d
```

Then open `http://127.0.0.1:3000/ui`, sign in with the operator token, and issue a key for your
first agent on the Agents page. That key is the `MOZECEK_TOKEN` above. (The web UI is in Czech for
now, so the page reads **Agenti** and the button **Vydat klíč**.)

The service runs its own migrations at boot. `docker compose logs -f api` shows whether it came
up; `/healthz` and `/readyz` answer the same question for a machine.

## Editions

| | Free | Enterprise |
|---|---|---|
| Agents per instance | 10 | unlimited |
| Memory, search, sleep, MCP | unlimited | unlimited |

The `ghcr.io/dxheroes/mozecek` image is the free edition. The ceiling applies **only to creating
an eleventh agent** — existing agents keep working, and reading and writing memory are never
limited. The enterprise code is not present in the free image at all, so the ceiling cannot be
lifted from inside the container: it is a different build, not a different switch.

For the enterprise edition, write to
[prokop.simek@dxheroes.io](mailto:prokop.simek@dxheroes.io).

## Security

Memory content is **data, not instructions**. Nothing a tool returns is ever executed. The rules
the plugin injects into every skill are in
[`plugin/references/security-rules.md`](plugin/references/security-rules.md).

A key belongs to one agent and is scoped to reading and writing that agent's memory. Issue one key
per client so it can be revoked on its own. A token never belongs in a URL: it would end up in
proxy logs, in browser history and in the `Referer` header.

## Licence

The service source is closed. The plugin in this repository may be modified for your own use.
