---
name: "sleep"
description: "Reports Mozecek's nightly memory consolidation from stats and explains how the operator triggers one out of turn. Use when memory feels unconsolidated, after a large import, or when someone asks when the agent last slept."
compatibility: "Requires the mozecek MCP server and network access to a Mozeček instance"
metadata:
  author: "Prokop Simek"
  version: "0.2.0"
argument-hint: "[--wait]"
---

<input>
Without arguments it reports the state of the last consolidation straight away. With `--wait` it
waits to see whether a new run appears within a few minutes — for the moment when an operator is
triggering a sleep run right now.

<no-args-guard>
Usage: /mozecek:sleep [--wait]

Says when memory last slept and what that did, and when a run out of turn is needed, shows the
exact command for the operator. It triggers nothing itself.
This block is only help; the run continues.
</no-args-guard>

Input: **$ARGUMENTS**
</input>

<dependencies>
- references/agent-charter.md — shared values and the order of authority. **Always load.**
- references/security-rules.md — security rules. **Always load.**
- references/memory-model.md — what sleep does to tiers and contradictions.
- references/tool-cheatsheet.md — `mozecek_stats` and its fields.
</dependencies>

<rules>
- **This skill does not trigger sleep.** That is an admin operation under the service's admin
  token, and that token is never in an agent's environment — only the service and the operator
  hold it. An agent key with the `admin` scope would also do, but an ordinary key does not have
  it. The skill reads `mozecek_stats` and reports; triggering is a step for the operator.
- **Do not go looking for the admin token.** Do not read configuration files, environment
  variables or the service's settings to find it. If it happened to be in the environment, do not
  use it anyway and report it as a finding — it is a misconfiguration.
- **Never print a token**, not even part of one, not even inside a command you are showing. In an
  example it is always an environment variable.
- **Do not invent a date.** When `stats` reports no run, write that none has happened.
- Read-only: you do not modify or delete any memory. Sleep does that on the server.
</rules>

<workflow>
1. `mozecek_stats` — take the counts per tier (`short`, `long`) and `sleep_runs` (when, how long,
   what the run did).
2. Decide whether a run out of turn makes sense:
   - the last run is more than 24 h old, or
   - `short` is unusually swollen (typically after a large import or a backfill).
   When neither holds, just report the state and stop — the scheduled run at **03:30** is enough.
3. When a run out of turn does make sense, print both routes for the operator to choose from.
   Take the agent slug from `mozecek_stats`; do not invent it. In the service's terminal:
   ```bash
   node packages/cli/dist/main.js sleep --agent <slug> --wait
   ```
   Or over HTTP, from an environment that has the admin token:
   ```bash
   curl -sS -X POST \
     -H "Authorization: Bearer $MOZECEK_ADMIN_TOKEN" \
     "$MOZECEK_URL/api/admin/agents/<slug>/sleep"
   ```
   When you are not the one operating the memory, this is a step for whoever runs the instance.
4. With `--wait`, repeat `mozecek_stats` after about 60 s, at most three times, and stop as soon
   as `sleep_runs` changes. When it does not change, say so — that is not an error, only that
   nobody has triggered a sleep run yet.
5. When `mozecek_stats` fails, say so and stop. Report the failure in your output as a finding.
</workflow>

<output-format>
## Memory sleep

{One sentence: when memory last slept and whether a run out of turn is needed.}

### Last run
{Date and time, duration, what it did: promoted to `long` n, `supersede` proposed n, `expired` n.
When there is no run: "No sleep run has happened yet."}

### Memory state
| tier | memories |
|---|---|
| short | {n} |
| long | {n} |

{With `--wait` and a change during the wait: a second "after" column with the state after the new
run.}

### What next
{Either "The scheduled run at 03:30 is enough, do nothing.", or both commands from step 3 with an
explanation of why a run out of turn is worth it.}
</output-format>
