# Rules for agents

This repository is public and holds two things: the [Agent Plugin](https://agent-plugins.org)
(`plugin/`) and instructions for self-hosting (`README.md`, `compose.yml`). The service itself is
not here.

- **Nothing about one particular deployment.** No instance address, no agent slug, no client name
  in the code or in the examples. Examples use `mozecek.example.com` and `<agent>`.
- **No default address.** `plugin/mcp.json`, `plugin/.mcp.json`, `plugin/bin/mcp-proxy.mjs` and
  `plugin/hooks/capture.mjs` must not carry a fallback URL, and the `url` option must not declare
  a `default`. Without an address the plugin does not connect, and that is correct.
- **No credentials in package data.** Agent Plugins requires configured headers to be literal and
  free of secrets, so the key never appears in `mcp.json`. It reaches `bin/mcp-proxy.mjs` at run
  time and nowhere else. A key never goes in a URL either: it would land in proxy logs, in
  browser history and in the `Referer` header.
- **Bump the version.** Both `plugin/plugin.json` and `plugin/.claude-plugin/plugin.json`, and
  keep them equal. The marketplace serves the second file verbatim and Claude Code caches the
  plugin by version, so an unbumped release leaves installed users on the old files.
- **English only.** This repository is public, so everything in it — README, descriptions, skills,
  references, comments — is written in English.
- Conventions for skills and subagents are in [`plugin/AGENTS.md`](plugin/AGENTS.md).

## Two layouts, one plugin

`plugin/` is laid out for the portable Agent Plugins format and for Claude Code at the same time,
because Claude Code is not an Agent Plugins client yet and reads different paths:

| Portable (every compatible client) | Claude Code |
| --- | --- |
| `plugin.json` | `.claude-plugin/plugin.json` |
| `mcp.json` (`${PLUGIN_ROOT}`) | `.mcp.json` (`${CLAUDE_PLUGIN_ROOT}`) |
| `skills/` | `skills/` |
| — | `hooks/`, `agents/` |

Keep both manifests in step. `hooks/` and `agents/` are Claude Code's own component types; other
clients ignore them. Skills are shared, so anything a skill loads must sit **inside that skill**:
Agent Skills resolves file references from the skill root, and `../` is not portable. The copies
under `skills/<name>/references/` are generated from `references/`, which stays the single source
of truth — `plugin/skills/references.test.mjs` fails if they drift.

## Checks

```bash
claude plugin validate ./plugin
claude plugin validate .
node --test plugin/hooks/capture.test.mjs plugin/bin/mcp-proxy.test.mjs plugin/skills/references.test.mjs
```

The portable manifests are validated against the published schemas:

```bash
curl -sO https://agent-plugins.org/schemas/1.0.0/plugin.schema.json
curl -sO https://agent-plugins.org/schemas/1.0.0/mcp.schema.json
```

Both schemas are closed, so an unknown top-level field is a violation.
