# Evals of the `mozecek` plugin

`claude plugin eval` runs a skill for real in a sandboxed `claude -p` and grades what it did. The
Mozeček server is replaced by canned answers from `mocks/`, so a run needs no instance, no key and
writes nothing anywhere.

## What the suite proves

| Case | Prompt | Passes when |
| --- | --- | --- |
| `remember-workspace` | `/mozecek:remember "…" --kind procedural --visibility workspace` | the duplicate search includes shared rows (`include_workspace: true`) and exactly one `mozecek_remember` call carries `visibility: "workspace"` |
| `remember-default-agent` | the same text without `--visibility` | the duplicate search stays with the agent's own rows (`include_workspace: false`), no call carries `visibility: "workspace"` and exactly one row is written |

The two prompts differ only in the flag, so the flag is the only thing that can explain a
different result. Memory holds nothing similar (`mocks/mozecek/mozecek_search.md` returns no hits),
so the run has to reach `mozecek_remember`, and the graders read the arguments the stand-in
received (`target: mock_calls`). `mocks/mozecek/_tools.json` is the server's own `tools/list`
for the two tools of this flow, so the model sees the real schema and nothing else.

## Running it

```bash
claude plugin eval ./plugin --ablation none --no-publish
```

Run it from the repository root, logged in to Claude Code. `--ablation none` skips the arm
without the plugin, which has nothing to grade here: without the plugin there is no
`/mozecek:remember`. One run of both cases costs about 0.30 USD; the cases ask for three runs
each. Results land in `plugin/evals/results/`, which git ignores, as it does
`mocks/recordings/`.

A run is paid and needs a login, so it is not part of the checks. `evals.test.mjs` is the free
half and runs with the other tests: it keeps the cases runnable, keeps the mocks under the
server key the plugin declares, and checks each grader against the calls it must tell apart, so a
grader that passes every run, or fails every run, is caught before anyone pays for it.

```bash
node --test plugin/evals/evals.test.mjs
```

## When the skill changes

Run the suite again after any change to `skills/remember/SKILL.md` or to the server's
`mozecek_remember` or `mozecek_search` schema, and refresh `_tools.json` from the server's
`tools/list` when the schema changed.
