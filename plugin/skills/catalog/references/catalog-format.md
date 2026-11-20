# Catalog format, schema 1

The files `bin/mozecek-catalog.mjs` reads and writes in a context repository. The Zod schemas in
the tool's source are binding; this file describes them. Every catalog file carries
`"schema": 1`.

## Files

| File | Written by | What for |
|---|---|---|
| `<name>.meta.json` | the tool | sidecar: the full card of one file, next to the original |
| `_context.json` | the tool | folder index, one per cataloged folder; over 256 kB is a warning |
| `.catalog.json` | a person | configuration of a catalog root; optional |
| `.contextignore` | a person | gitignore-style patterns of files never sent to the model |
| `_index.json` | a person | captions of a folder's files; the tool reads it and never writes it |

`build` and `check` catalog Git-tracked originals, including staged additions. They skip
symlinks and submodules. They can discover generated sidecars, folder indexes and nested
`.catalog.json` files before staging, as long as Git does not ignore them.

Catalog artifacts are excluded from the list of originals. These are `_context.json`,
`.catalog.json`, `.contextignore` and `X.meta.json` if a tracked `X` exists next to it or the
sidecar contains a valid card for `X`. Use `describe <file>` for a single named file, such as
an untracked attachment or a file outside a Git repository.

**When a sidecar exists.** Text, data and code files under 200 lines (`sidecar_min_lines` in
`.catalog.json` changes the number) keep their card inline in the folder index. Every other file
gets a sidecar.

## Card

```json
{
  "schema": 1,
  "name": "offer.pdf",
  "kind": "pdf",
  "mime": "application/pdf",
  "bytes": 482113,
  "sha256": "…",
  "title": "Offer – reporting modernisation",
  "summary": "…",
  "keywords": ["…"],
  "entities": ["acme-corp"],
  "language": "en",
  "structure": { "transcript": "…" },
  "description": { "status": "model", "model": "gemini-flash-latest", "reason": null },
  "inherited": {}
}
```

| Field | Value |
|---|---|
| `name` | file name of the original, without its folder |
| `kind` | `text`, `data`, `code`, `image`, `pdf`, `sheet`, `slides`, `document`, `audio`, `video`, `other` |
| `mime` | mime type of the original |
| `bytes` | size of the original |
| `sha256` | of the original bytes, lowercase hex; `null` only when the file could not be read. A card is fresh while this matches the file |
| `title` | title read from the file, or `null` |
| `summary` | at most 600 characters, in the language of the source; `null` until a model or an inherited source describes the file |
| `keywords` | at most 12, in the language of the source |
| `entities` | at most 16 slugs (`a-z`, `0-9`, single hyphens): names written or spoken in the file |
| `language` | BCP 47 tag of the dominant language (`cs`, `en-GB`), or `null` |
| `structure` | what the tool read from the bytes, by `kind` (below) |
| `description` | who described the file (below) |
| `inherited` | fields people wrote about the file, copied unchanged; `{}` when there are none |

### `description`

- `status: "model"` — a model wrote `summary`, `keywords`, `entities`, `language` and a media
  transcript. `model` names it.
- `status: "inherited"` — the summary came from what people wrote (below); `model` is `null`.
- `status: "none"` — nobody described the file; `model` is `null` and `reason` says why:

| `reason` | Meaning |
|---|---|
| `ignored` | matched by `.contextignore`, so never sent to the model |
| `code` | source code; its card stays technical |
| `too_large` | over 20 MiB |
| `unsupported` | a type the model is not given |
| `model_error` | the model call failed; the next build asks again |
| `no_model` | built with `--no-model`, or left over after `--max-calls`; the next build with a model asks |

`reason` is set exactly when `status` is `none`.

**Refreshing cached descriptions.** A regular build reuses the model description of an unchanged
file. Use `build [<root>] --refresh-kind <kind,...>` to refresh cached model descriptions for the
selected file kinds, such as `sheet,slides,document`. This requires a model. Files with inherited
descriptions keep them. If a model call fails or the build reaches `--max-calls`, run a regular
build to finish the refresh and reuse completed descriptions.

### Inherited descriptions and `inherited`

A summary people already wrote is taken instead of asking a model, and the file is not sent:

- a markdown file's frontmatter `summary`, else its `description`;
- the `caption` of the file's entry in its folder's `_index.json`. For `build` and `check`,
  that index must be Git-tracked.

Such a card has `description.status: "inherited"`, keywords from the same source's `keywords`
else `tags`, empty `entities` and `language: null`. Source code never inherits a description.
`.contextignore` keeps a file from the model, not from what people wrote: an ignored file with a
frontmatter summary still gets it.

`inherited` holds these keys when the source has them, with or without a summary:
`status`, `read_when`, `audience` (frontmatter) and `context`, `people`, `faces_visible`,
`best_for`, `avoid_for` (`_index.json` entry). `people` exists only here, from what a person
wrote. The tool never identifies a person by face or voice, and no model is asked who is in a
picture.

### `structure` by `kind`

| `kind` | `structure` |
|---|---|
| `text` | `{ "lines": n, "outline": [{ "title", "level", "line" }], "frontmatter": ["key", …] }` — `line` is 1-based and counts frontmatter lines; `frontmatter` lists top-level keys in file order |
| `data` | csv/tsv `{ "rows": n, "columns": [] }` (rows below the header); jsonl/ndjson `{ "rows": n, "keys": [] }` (union of top-level keys of the first rows); json `{ "keys": [] }` (top-level keys of an object, empty for an array or a scalar) |
| `code` | `{ "lines": n }` |
| `sheet` | `{ "sheets": [{ "name", "rows", "columns": [] }] }` — rows with content below each header row |
| `slides` | `{ "slides": [{ "n", "title" }] }` — numbered from 1, `title` may be `null` |
| `document` | `{ "outline": [{ "title", "level" }] }` |
| `pdf`, `image`, `audio`, `video` | `{ "transcript": "…" \| null }` — text readable or spoken in the file, verbatim, at most 4 000 characters; `null` until a model fills it or when there is none |
| `other` | `{}` |

`{}` is allowed for every kind: the content was not parsed because the file is too large, could
not be read, or is not what its name says.

## Folder index `_context.json`

```json
{
  "schema": 1,
  "path": "clients/acme",
  "summary": "…",
  "children_sha256": "…",
  "folders": [{ "name": "materials", "summary": "…", "files": 12 }],
  "catalogs": [{ "name": "archive", "summary": "…" }],
  "collections": [{ "name": "threads", "index": ["index/threads.json"], "note": "…" }],
  "files": [{ "name": "offer.pdf", "kind": "pdf", "sidecar": true, "…": "…" }]
}
```

| Field | Value |
|---|---|
| `path` | relative to the catalog root, `/`-separated; the root is `"."` |
| `summary` | at most 600 characters, written by the model from the folder's entries; `null` without one |
| `children_sha256` | sha256 of the names of all entries (folders, files, catalogs, collections), byte-sorted and joined by `\n` |
| `folders[]` | `name`; `summary` copied from the subfolder's own `_context.json`; `files` = cataloged files in the subfolder and everything below it |
| `catalogs[]` | subfolders with their own `.catalog.json`: separate catalogs this one never enters or writes. `summary` comes from their root `_context.json` |
| `collections[]` | folders declared in `.catalog.json`, listed and never entered: `name`, `index` (files relative to the catalog root that describe the collection, may be empty), `note` |
| `files[]` | one entry per original in the folder |

A `files[]` entry for a file **with** a sidecar is the short card: every card field except
`structure` and `inherited`, plus `"sidecar": true`; the rest is in `<name>.meta.json`. A file
**without** a sidecar appears as the full card plus `"sidecar": false`.

**When a folder summary is rewritten.** The model reads up to 200 entries per folder, in order
of subfolders, nested catalogs, collections, then files. It reads names, summaries and file
counts for subfolders, names and summaries for nested catalogs, names and notes for collections,
and names, kinds, titles, summaries and languages for files. The build starts with the deepest
folders and recomputes a summary when one is missing, when the entry names (`children_sha256`)
or any of those facts change, or when `--force` is set. If a model call fails or the call limit
is reached, the build leaves a missing or outdated summary as `null` so the next build with a
model retries it. A build without a model keeps an existing summary while the entry names stay
the same and drops it when they change. `check` verifies that each subfolder's entry in its
parent repeats the summary in the subfolder's own `_context.json`.

## Configuration `.catalog.json`

```json
{
  "schema": 1,
  "include": ["docs/**", "db/**"],
  "skip": ["**/node_modules/**"],
  "collections": [{ "path": "threads", "index": ["index/threads.json"], "note": "…" }],
  "sidecar_min_lines": 200
}
```

| Key | Value |
|---|---|
| `schema` | `1`, optional |
| `include` | gitignore-style patterns that limit which Git-tracked originals to catalog. Omit it to include all eligible originals under the root |
| `skip` | gitignore-style patterns of files left out of the catalog entirely |
| `collections` | `[{ path, index, note }]`: `path` is a folder inside the root, `index` a list of files inside the root (may be empty), `note` free text for the agent |
| `sidecar_min_lines` | positive integer; replaces the 200-line sidecar threshold |

Every key is optional and `{}` means the defaults; no file means the same. An unknown key,
invalid JSON or a path that leaves the root is an error, never a silent default. A missing
collection path or index file is a warning. The tool reads `.catalog.json` only at the root it
was given.

## `.contextignore`

Gitignore syntax, at the catalog root. A matching file is still cataloged and gets a technical
card with `description.reason: "ignored"` (unless people wrote a summary for it), but its
content is never sent to the model.
