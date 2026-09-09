# Mozeček's memory model

What a memory is, how it ages, and what the fields the `mozecek_*` tools return mean.

## Contents
- [Tiers](#tiers)
- [Kinds](#kinds)
- [Status and the supersede chain](#status-and-the-supersede-chain)
- [Visibility](#visibility)
- [Bitemporality and `as_of`](#bitemporality-and-as_of)
- [Confidence](#confidence)
- [Citations](#citations)
- [Sleep](#sleep)
- [Workspace](#workspace)

## Tiers

| tier | what lives there | for how long |
|---|---|---|
| `short` | what is happening now: work in progress, fresh session context | days; sleep promotes it, or its TTL expires |
| `long` | a settled fact, a procedure, a preference; identity and hard rules belong here too | permanently, until something replaces it |

There are only two tiers. A new memory without a `tier` lands in `short`. It moves to `long`
either through sleep (a repeated occurrence, a confirmation) or through `remember --long` for
something that is clearly going to keep holding.

## Kinds

- `semantic` — a fact about the world, a company, a person ("Heureka invoices quarterly").
- `procedural` — how something is done ("deploys go through Coolify, auto-deploy is off").
- `episodic` — what happened, with a time ("on 7 Sep 2026 we agreed…").
- `note` — a note with no claim to truth, an idea.

Documents synchronised from a file tree have their own kinds, which the tools return in results:
`fact`, `summary`, `evidence` (the original), `profile`, `note`, `entity`. Those are not written
through `remember` — they come from synchronisation and their truth lives in the source repo.

## Status and the supersede chain

**Being superseded is not a status.** `status` takes these values:

| status | what it means |
|---|---|
| `active` | a valid memory — including one that something has already superseded |
| `expired` | a short-term memory whose TTL ran out and sleep did not promote |
| `archived` | set aside: gone from ordinary search, still in the audit trail |
| `forgotten` | forgotten through `forget`; not returned, not gone from the audit trail |

- `supersede(old_id, content, reason)` creates a new memory and adds `superseded_by: <new id>`
  and `valid_until` to the old one. **The old memory's status stays `active`** — it did not stop
  being true, it stopped holding as of today. The original text stays readable; the history of a
  decision is information too.
- `forget(id, reason)` switches the status to `forgotten`. A last resort.
- When a hit carries `superseded_by`, give both in your answer: what holds now and what held
  before (up to `valid_until`). Do not reconcile them into one sentence.
- Ordinary search does not return superseded versions. `include_superseded: true` is for
  questions like "what did we think in June", not for everyday search.

## Visibility

`visibility` decides what may leave an agent: `private` (this agent only) or `workspace` (shared
between agents in the same workspace). The default is `private` — sharing is a deliberate
decision, not a default. `include_workspace: true` on a search pulls in the shared memories of
the workspace's other agents.

## Bitemporality and `as_of`

Every memory carries two times:

- `observed_at` — when what the memory claims was true (world time).
- `recorded_at` — when Mozeček learned it (system time).

That makes two different questions possible: "what held on 1 July" (`as_of: "2026-07-01"` filters
by `observed_at`) and "what did we know by 1 July" (what had a `recorded_at` by then). `from` and
`to` narrow `observed_at`. When a source gives no time, `observed_at` is `null` — do not compute
one.

## Confidence

A number from 0 to 1. The labels to use in answers:

| range | label |
|---|---|
| ≥ 0.75 | high |
| ≥ 0.45 and < 0.75 | medium |
| < 0.45 | low |

`min_confidence` on a search filters weak hits out. Low confidence is admitted in an answer, not
hidden. Anything not explicitly in the quote is low — do not fill in the gap.

## Citations

For every hit the tools return `{ memory_id, path, line, line_end, quote, timestamp, url, sha256,
observed_at, recorded_at, confidence }`. `path` and `line` point into a repository when the
memory came from file synchronisation — there the citation can be checked on disk:

```bash
sed -n '17,25p' <path from the citation>
```

No citation, no finding. When a tool returned no citation, say so rather than supplying one.

## Sleep

The nightly consolidation (03:30). What it does: promotes repeated `short` memories to `long`,
looks for contradictions and proposes `supersede`, recomputes the agent's profile, and applies
the TTL to `short` memories nobody confirmed (they end up `expired`). Memories from a
synchronised file tree (`source.type: brain`) are never merged or retired by sleep; their truth
is the file. They only feed the per-entity and per-tag summaries. The result shows up in `stats`
as `sleep_runs`. Running it by hand is described by the `/mozecek:sleep` skill.

## Workspace

A workspace groups the agents of one person or team; anyone outside it gets their own workspace,
so the two cannot see each other. Every agent has its own memory; the only thing shared is what
carries `visibility: workspace`.
