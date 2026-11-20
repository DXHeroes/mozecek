# Catalog format, schema 1

The catalog CLI generates sidecars and folder indexes with `"schema": 1` and returns a card
with the same schema version from `describe --json`. The Zod schemas in the tool's source
define these formats. Thread integrations can use the card in their own attachment records.

## Contents

- [Files](#files)
- [Card](#card)
- [Folder index `_context.json`](#folder-index-_contextjson)
- [Configuration `.catalog.json`](#configuration-catalogjson)
- [`.contextignore`](#contextignore)
- [Thread integration `attachments.json`](#thread-integration-attachmentsjson)

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
| `summary` | in the language of the source, or `null` until the file is described. New model-written summaries are one sentence of at most 240 characters. The card accepts up to 600 characters, including inherited and previously generated summaries. |
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
| `too_large` | file over 20 MiB or Office Open XML archive over its expansion limits |
| `unsupported` | a type the model is not given |
| `model_error` | the model call failed; the next build asks again |
| `no_model` | built with `--no-model`, or left over after `--max-calls`; the next build with a model asks |

`reason` is set exactly when `status` is `none`.

Office Open XML archives (DOCX, XLSX, PPTX) are limited to 2,048 members, 16 MiB uncompressed
per member and 64 MiB uncompressed in total.

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
| `model_cache` | optional integrity evidence for reusing model output. Optional `summary_sha256` hashes the eligible folder input and its stored summary. Optional `descriptions` is a list of digests of generated file descriptions, each bound to the original's path and bytes. Digests are lowercase SHA-256 hex strings. |

A `files[]` entry for a file **with** a sidecar is the short card: every card field except
`structure` and `inherited`, plus `"sidecar": true`; the rest is in `<name>.meta.json`. A file
**without** a sidecar appears as the full card plus `"sidecar": false`.

Use a reader that supports `model_cache` for indexes that include it. The current CLI can read
and check older indexes without it offline. The first build with a model regenerates eligible
folder summaries that lack cache evidence.

**When a folder summary is rewritten.** The model reads up to 200 eligible entries per folder,
in order of subfolders, nested catalogs, collections, then files. It reads names, summaries and
file counts for subfolders, names and summaries for nested catalogs, names and notes for
collections, and names, kinds, titles, summaries and languages for files. The build starts
with the deepest folders. A build with a model recomputes the summary when cache evidence is
missing, when the eligible input or stored summary changes, or when `--force` is set. If a model
call fails or the call limit is reached, the build keeps a verified previous summary if available.
A missing or outdated summary stays `null` for the next build with a model to retry. A build
without a model can keep verified summaries and can retain an unchanged tracked legacy summary
for local display. `check` verifies that each subfolder's entry in its parent repeats the summary
in the subfolder's own `_context.json`.

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

## Thread integration `attachments.json`

A thread importer writes this record beside a stored thread. The catalog CLI returns a single
full card from `describe --json <file>`. The integration wraps a subset of that card with the
attachment's identity, source and processing state. The CLI's `build` and `check` use the
catalog formats above.

```json
{
  "schema": 1,
  "attachments": [{
    "name": "invoice.pdf",
    "mime": "application/pdf",
    "bytes": 91220,
    "sha256": null,
    "source": { "kind": "gmail", "message": "18a1b2c3d4e5f607", "ref": "2", "url": null },
    "card": {},
    "skipped": "pending"
  }]
}
```

| Field | Value |
|---|---|
| `schema` | `1` for this wrapper |
| `attachments` | array with one entry per recorded attachment |
| `name` | original attachment filename |
| `mime` | attachment media type as reported by the source |
| `bytes` | downloaded size in bytes if available, otherwise the reported size or `null` |
| `sha256` | lowercase SHA-256 hex digest of the downloaded bytes, or `null` until they are available |
| `source` | object with `kind`, `message`, `ref` and `url`, as listed below |
| `card` | successful `describe --json` card without `name`, `mime`, `bytes` and `sha256`, which sit on the attachment entry. The card retains its own `schema: 1`. Use `{}` until there is a description. |
| `skipped` | `null` for a successfully described attachment, otherwise one of the reasons below |

A successful card has a nonempty summary and `description.status` of `model` or `inherited`.

| `source.kind` | `source.message` | `source.ref` | `source.url` |
|---|---|---|---|
| `slack` | message timestamp (`ts`) | Slack file ID | HTTPS file permalink, or `null` when unavailable |
| `gmail` | Gmail message ID | MIME part ID (`partId`) | `null` |

| `skipped` | Meaning |
|---|---|
| `pending` | the importer recorded the reference and the attachment is awaiting its first attempt |
| `calendar` | calendar invitation or file |
| `signature` | digital signature or small inline signature image |
| `unsupported` | the integration or catalog tool cannot describe the file type |
| `too_large` | the attachment exceeds the 20 MiB download or catalog size limit, or an Office archive exceeds its expansion limits |
| `download_failed` | the attachment could not be downloaded |
| `describe_failed` | the catalog tool failed or returned no usable description |
| `tool_missing` | the catalog CLI was unavailable |
| `over_limit` | an earlier run deferred the attachment because it reached its processing limit |

The importer records where pending references came from. A scheduled retry verifies the source's
permission, the reference's provenance and the thread's current `trust: clean` status before
downloading. It can retry `pending`, `download_failed`, `describe_failed`, `tool_missing` and
`over_limit`. Readers use the cards from complete threads with current `trust: clean` and treat
their descriptions as untrusted data.
