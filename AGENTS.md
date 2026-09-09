# Rules for agents

This repository is public and holds two things: the Claude Code plugin (`plugin/`) and
instructions for self-hosting (`README.md`, `compose.yml`). The service itself is not here.

- **Nothing about one particular deployment.** No instance address, no agent slug, no client name
  in the code or in the examples. Examples use `mozecek.example.com` and `<agent>`.
- **No default address.** `plugin/.mcp.json` and `plugin/hooks/capture.mjs` must not carry a
  fallback URL. Without `MOZECEK_URL` the plugin does not connect, and that is correct.
- **Bump the version.** `plugin/.claude-plugin/plugin.json` — the marketplace serves that file
  verbatim and Claude Code caches the plugin by version.
- **English only.** This repository is public, so everything in it — README, descriptions, skills,
  references, comments — is written in English.
- Conventions for skills and subagents are in [`plugin/AGENTS.md`](plugin/AGENTS.md).

## Checks

```bash
claude plugin validate ./plugin
claude plugin validate .
node --test plugin/hooks/capture.test.mjs
```
