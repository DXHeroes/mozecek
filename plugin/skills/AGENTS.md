# Catalogue of the `mozecek` plugin's skills

Every skill in this directory has exactly one row below, and every row has a folder. When one of
those two lists stops matching the other, that is a bug.

| Skill | Folder | Description |
|---|---|---|
| `/mozecek:remember` | `remember/` | Stores one memory after a duplicate check; on a match, `update` or `supersede` instead |
| `/mozecek:recall` | `recall/` | Searches memory and answers with citations, superseded versions and admitted gaps; read-only |
| `/mozecek:sleep` | `sleep/` | Reports the nightly consolidation from `stats`, and the command for an operator when a run out of turn is needed |
| `/mozecek:review` | `review/` | Reviews recent memory: duplicates, contradictions, thinly evidenced rows; writes only with `--apply` |
