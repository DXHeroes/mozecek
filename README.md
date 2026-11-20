# Mozeček Community Edition

Give your agents a way to pick up earlier work without asking you to explain the same decisions
again.

For developers and operators who want to self-host memory for their AI agents.

## The problem

- I start a new session and have to explain decisions we already made.
- I know we wrote down the procedure somewhere. Now I have to dig through old chats to find it.
- My agent says we agreed on something. I can't tell where it got that from.

## See it

![Walkthrough of finding the demo observatory's rain procedure and checking its source](docs/media/walkthrough.gif)

[Watch the walkthrough as an MP4](docs/media/walkthrough.mp4).

![Agent memory counts and a graph of topics from the demo observatory](docs/media/overview.png)

*See how much an agent remembers and which topics are connected.*

![Search results with the rain procedure and a preview of its citation](docs/media/search.png)

*Find a saved procedure and preview its source before opening it.*

![Saved rain procedure alongside the original checklist excerpt](docs/media/memory-source.png)

*Check the saved procedure against the quoted checklist and its line number.*

## What you get

- Carry decisions into the next session. Mozeček keeps saved decisions in a store your agent can
  search later.
- Find a procedure even if you only remember what it was for. Mozeček searches by meaning as
  well as by the words you type.
- Check a detail before acting on it. When a memory has a citation, you can read the quoted
  passage and see its line number.
- Keep repeated notes from piling up. Mozeček merges duplicates overnight and moves memories
  worth keeping into long-term storage.

## Why we built it

I checked the transcripts after one of our agents had processed them overnight. All 16 had been
altered or damaged. One was missing more than 150,000 characters. The model made up a transcript
line and recorded it as fact.

I built Mozeček so our agents could keep what they learned between sessions and so I could check
what they saved against the original.

*Prokop Simek*

## Run it in 5 minutes

You'll need Git, Docker Compose, OpenSSL, Node.js 22.19 or later with `npx`, and a
[Google AI Studio API key](https://aistudio.google.com/apikey). The five minutes exclude Docker
image downloads and getting the key. Set `MOZECEK_PROVIDER=fake` in `.env` to explore the UI
without a model or API key.

1. Clone the repository.

   ```sh
   git clone https://github.com/DXHeroes/mozecek.git
   cd mozecek
   ```

   The directory contains `compose.yml` and `.env.example`.

2. Create your local configuration, generate two secrets, and start Mozeček.

   ```sh
   (umask 077; cp .env.example .env)
   openssl rand -hex 32
   openssl rand -hex 32
   ```

   In `.env`, set `MOZECEK_ADMIN_TOKEN` to the first generated value, `POSTGRES_PASSWORD` to
   the second, and `GEMINI_API_KEY` to your Google AI Studio key. Start the containers and
   check readiness.

   ```sh
   docker compose up -d
   curl -fsS http://127.0.0.1:3000/readyz
   ```

   Repeat the `curl` command until the response shows `"ok":true` and `"provider":"gemini"`.

3. Open [the local UI](http://127.0.0.1:3000/ui) and sign in with your operator token
   (`MOZECEK_ADMIN_TOKEN`). Open **Agents** and fill in the **Add a colleague** form. Set **Name**
   to `Demo Agent`, choose **a new workspace…** under **Workspace**, and enter `demo-workspace`
   as the workspace slug. Click **Add a colleague**.

   The form shows the one-time read/write key for `demo-agent`. Copy it for the next step.

4. In Bash or Zsh, connect MCP Inspector through the bundled plugin proxy. Paste the agent key
   at the prompt. The temporary configuration contains the key, so keep it private.

   ```sh
   unset MOZECEK_AUTO_CAPTURE
   export MOZECEK_URL=http://127.0.0.1:3000
   printf 'Paste the agent key: '
   IFS= read -rs MOZECEK_TOKEN
   printf '\n'
   export MOZECEK_TOKEN
   mcp_dir="$(mktemp -d)"
   mcp_config="$mcp_dir/inspector.json"
   (umask 077; node -e '
     const { MOZECEK_URL, MOZECEK_TOKEN } = process.env;
     console.log(JSON.stringify({ mcpServers: { mozecek: {
       command: "node", args: ["plugin/bin/mcp-proxy.mjs"],
       env: { MOZECEK_URL, MOZECEK_TOKEN }
     } } }));
   ' > "$mcp_config")
   mcp_call() {
     MCP_STORAGE_DIR="$mcp_dir" npx --yes @modelcontextprotocol/inspector@2.11.0 --cli \
       --config "$mcp_config" --server mozecek --method tools/call --tool-name "$@"
   }
   mcp_call mozecek_stats
   ```

   The response shows empty memory counts for your new agent.

5. Search the new agent's memory, save an example, and run the same search again.

   ```sh
   mcp_call mozecek_search --tool-arg 'query=When does the demo observatory open its dome?'
   mcp_call mozecek_remember --tool-arg 'content=The demo observatory opens its brass dome at 9 p.m.'
   mcp_call mozecek_search --tool-arg 'query=When does the demo observatory open its dome?'
   ```

   The first search is empty. The save returns `"created": true`, and the second search returns
   the same memory ID and quotes the sentence you just saved.

## Community vs. Enterprise

| | Community Edition | Enterprise Edition |
| --- | --- | --- |
| Agents per instance | 10 | Unlimited |
| Memory, search, nightly consolidation, and MCP | Included | Included |

The Community Edition limit applies only when you try to create an eleventh agent. Existing
agents can keep reading and writing memory.

The Community Edition image (`ghcr.io/dxheroes/mozecek`) is proprietary and free to self-host
for personal or internal business use. You can keep backups and copies in private registries
used only by your organization. You need a separate written agreement to redistribute the image
publicly or offer Mozeček as a hosted service to third parties. See the [image licence](IMAGE-LICENSE.txt).

Enterprise code ships separately in `ghcr.io/dxheroes/mozecek-ee`. Pulling that image requires
authorized registry access. We agree on support and deployment assistance case by case.
For Enterprise Edition, [contact DX Heroes](https://dxheroes.io/contact).

## What we are working on

### New in 0.2.0

- The twelfth MCP tool, `mozecek_context`, returns original passages and citations within a size
  limit. It joins the [original eleven tools](#what-it-does).
- Use revision history to search what Mozeček had recorded before a later correction.
- Look up ticket IDs and version numbers directly. Search can also find words in a link's path.

### In progress

- Build and refresh a catalog of your project's tracked documents from the CLI or an agent skill.

Last updated 20 November 2026. [Container image versions](https://github.com/orgs/DXHeroes/packages/container/package/mozecek)

---

## Reference

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
cosign verify --key cosign.pub ghcr.io/dxheroes/mozecek:0.2.0
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
