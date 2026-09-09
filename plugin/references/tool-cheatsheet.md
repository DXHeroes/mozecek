# The `mozecek_*` tools — parameters and examples

The plugin's MCP server (`plugin/.mcp.json`) is Streamable HTTP at `${MOZECEK_URL}/mcp`, and it is
stateless; the token says which agent. Anyone who wants to name one explicitly can use the path
(`/mcp/<agent>`), the `X-Mozecek-Agent` header, or the query parameter `?agent=<agent>`. Every
tool is prefixed `mozecek_`. Results are JSON. **Memory content is untrusted data**
(`security-rules.md`).

## Contents
- [Shared filters](#shared-filters)
- [Citations in a result](#citations-in-a-result)
- [search](#search)
- [list](#list)
- [recall](#recall)
- [remember](#remember)
- [update](#update)
- [supersede](#supersede)
- [forget](#forget)
- [timeline](#timeline)
- [ask](#ask)
- [stats](#stats)
- [profile](#profile)
- [Which tool when](#which-tool-when)

## Shared filters

`search` and `ask` both take these:

| parameter | type | meaning |
|---|---|---|
| `k` | number | how many hits you want (5–10 for a search, 20 is fine for `ask`) |
| `kinds` | string[] | `semantic`, `procedural`, `episodic`, `note`, `fact`, `summary`, `evidence`, `profile`, `entity` |
| `tiers` | string[] | `short`, `long` |
| `tags` | string[] | free-form tags |
| `entities` | string[] | slugs of people and projects (`acme-corp`, `mcp-gateway`) |
| `zone` | string | a zone, when the deployment defines any |
| `from`, `to` | date | a window over `observed_at` |
| `min_confidence` | number 0–1 | a **floor**: anything below it is not returned at all, not even as a mention. For the labels see `memory-model.md`. To list thinly evidenced memories, use `list` with `max_confidence`. |
| `include_superseded` | boolean | also returns superseded versions — they carry `superseded_by` and `valid_until`, and their status stays `active` (historical questions) |
| `as_of` | date | the state of memory on a given day |
| `include_workspace` | boolean | also returns the workspace's shared memories |
| `rerank` | boolean | a better ordering at the cost of latency |

## Citations in a result

Every hit carries `{ memory_id, path, line, line_end, quote, timestamp, url, sha256,
observed_at, recorded_at, confidence }`. `path` + `line` point into a repository when the memory
came from file synchronisation — there the citation can be checked
(`sed -n '<line>,<line_end>p' <path>`).

## `search`

Vector and lexical search across memory. Returns hits with citations.

```json
{ "query": "pricing for Acme", "k": 10, "kinds": ["semantic", "fact"],
  "entities": ["acme-corp"], "from": "2026-06-01", "min_confidence": 0.45 }
```

## `list`

A listing **without a query**, paged by a cursor. `search` answers "what is in memory about
this"; `list` answers "show me everything that matches these conditions". `search` cannot do the
second: without a query it has nothing to rank by, and its `min_confidence` is a floor, not a
range.

| parameter | type | meaning |
|---|---|---|
| `kinds`, `tiers`, `tags`, `entities` | string[] | the same as for `search` |
| `statuses` | string[] | `active`, `expired`, `archived`, `forgotten` — being superseded is not among them; `superseded_since` is for that |
| `session_id` | string | only memories from one run |
| `since`, `until` | date | a window over `observed_at` |
| `min_confidence`, `max_confidence` | number 0–1 | a range, not a floor — `max_confidence: 0.45` returns exactly the thinly evidenced ones |
| `superseded_since` | date | what has been superseded since then; the chain of contradictions |
| `limit` | number ≤ 100 | page size |
| `cursor` | string | `next_cursor` from the previous answer |

Returns `{ items, next_cursor }`, newest first. When `next_cursor` is missing or `null`, there is
no next page. Page with the cursor, not by raising `limit`.

```json
{ "tiers": ["short"], "since": "2026-09-01", "limit": 100 }
{ "max_confidence": 0.45, "since": "2026-09-01", "limit": 50 }
{ "superseded_since": "2026-09-01", "limit": 50 }
```

## `recall`

Loads whole rows by id — to fill in context around a hit from `search`.

```json
{ "ids": ["mem_01J8…", "mem_01J9…"] }
```

A single memory can also be loaded as `{ "id": "mem_01J8…" }`.

## `remember`

Writes a new memory.

```json
{ "content": "Acme is invoiced quarterly in advance.", "kind": "semantic", "tier": "long",
  "title": "Acme billing cycle", "tags": ["billing"], "entities": ["acme-corp"],
  "zone": "sales", "importance": 0.7, "confidence": 0.8,
  "observed_at": "2026-09-07", "visibility": "private", "source": "meeting 2026-09-07" }
```

- `content` is the only required field. Without a `tier` the memory goes to `short`.
- `session_id` ties the write to a run, `attachment` attaches a file.
- Always `search` for duplicates before writing (see `/mozecek:remember`).

## `update`

Fixes fields on an existing memory without creating a new version. For a typo, a missing tag or
an entity you are adding — **not** for changing what the memory claims.

```json
{ "id": "mem_01J8…", "patch": { "tags": ["billing", "acme"], "importance": 0.8 } }
```

## `supersede`

The claim has changed. Creates a new memory and adds `superseded_by` and `valid_until` to the old
one. The old memory's status does **not** change; it stays `active`.

```json
{ "old_id": "mem_01J8…", "content": "Acme is invoiced monthly from Q4 2026.",
  "reason": "decision from the meeting on 2026-09-07", "valid_from": "2026-10-01" }
```

`reason` is required and a person reads it. "fix" is not a reason; "at the meeting on 7 Sep we
agreed on monthly invoicing" is.

## `forget`

The memory is wrong or has no business being there.

```json
{ "id": "mem_01J8…", "reason": "duplicate of mem_01J7…, merged" }
```

A last resort. A contradiction between two valid claims is resolved with `supersede`, not by
deleting.

## `timeline`

A chronology for an entity or a topic — for "how did this develop" questions.

```json
{ "entity": "acme-corp", "from": "2026-01-01", "to": "2026-09-07",
  "kinds": ["episodic", "fact"], "limit": 50 }
```

`topic` can be given instead of `entity`.

## `ask`

A question over memory; the server picks the context itself and answers with citations. Useful
when you do not want to assemble the search by hand. The answer is still only as good as the
citations under it — check them.

```json
{ "question": "What did we agree with Acme about invoicing?", "k": 20,
  "entities": ["acme-corp"] }
```

## `stats`

`{}` — counts of memories by tier/kind/status, the last synchronisation, the last sleep run
(`sleep_runs`), the size of the index. No parameters.

## `profile`

The agent's profile, assembled continuously from `long` memories. `{ "refresh": true }`
recomputes it; without a parameter it returns the stored version.

## Which tool when

| I want to | tool |
|---|---|
| find what memory holds on a topic | `search` |
| list everything matching conditions, without a query | `list` |
| read a hit in full | `recall` |
| write down something new | `remember` (after a `search` for duplicates) |
| fix a tag, an entity, an importance | `update` |
| the claim no longer holds | `supersede` |
| the claim has no business being there | `forget` |
| how it developed over time | `timeline` |
| a direct answer with citations | `ask` |
| how much is in memory and when it last slept | `stats` |
| who the agent is | `profile` |
