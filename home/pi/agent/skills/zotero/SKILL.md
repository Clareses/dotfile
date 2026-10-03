---
name: zotero
description: >-
  Query your local Zotero library, and organize it (create collections, move items).
  Search supports keyword, fulltext, author, collection, tag, DOI, and recent-additions search.
  Writes go through the Zotero Local HTTP API.
  Trigger: /zotero, "my papers", "Zotero", "find paper", "references", "citations",
  "organize my Zotero", "move papers into a collection".
  After installation, verify DEFAULT_DB path in scripts/zotero-search.py points to your zotero.sqlite.
disable-model-invocation: true
---

# Zotero Local

Query a local Zotero library (`zotero.sqlite`), read-only, zero external dependencies.
Organize it (create collections, move items) through the Zotero Local HTTP API.

> **Setup**: The default database path is `~/zotero/zotero.sqlite` on this machine (configured in `scripts/zotero-search.py`).
> Windows users: change `DEFAULT_DB` in `scripts/zotero-search.py` to your Zotero data directory,
> typically `C:\Users\<username>\Zotero\zotero.sqlite`.
> You can also override per-call with `--db PATH`.
>
> **Searching** reads the SQLite file directly. **Writing** needs the Zotero desktop
> app running with the local API enabled — see [Write Operations](#write-operations-local-api).

## Tool

```bash
python3 ~/.pi/agent/skills/zotero/scripts/zotero-search.py <mode> <query> [options]
```

### Search Modes

| Mode | Command | Description |
|------|---------|-------------|
| Keyword search | `search "query"` | Search title, abstract, journal, authors, notes |
| Fulltext search | `fulltext "word1 word2"` | Search PDF body text (inverted index, exact word match, AND semantics), ranked by metadata relevance |
| Author search | `author "name"` | By author name (partial match) |
| Browse collection | `collection list` / `collection "name"` | List or browse collections |
| Recent additions | `recent [--days N]` | Items added in last N days (default: 30) |
| Tag search | `tag list` / `tag "name"` | List or search by tag |
| DOI lookup | `doi "10.xxxx/..."` | Exact DOI match |
| Get by key | `get KEY1 KEY2 ...` | Batch fetch by itemKey, preserves input order |

### Global Options

| Flag | Default | Description |
|------|---------|-------------|
| `--limit N` | 20 | Max results |
| `--type TYPE` | all | Filter by type: `journalArticle` / `book` / `conferencePaper` / `preprint` |
| `--compact` | false | Compact output (title, authors, year, journal, URI only) — good for scanning |
| `--db PATH` | `~/zotero/zotero.sqlite` | Override database path |

## Write Operations (Local API)

`scripts/zotero-write.py` creates collections and moves items via the Zotero
**Local HTTP API**. It does not touch `zotero.sqlite`; Zotero must be running.

**Enable once** in Zotero → Settings → Advanced:
"Allow other applications on this computer to communicate with Zotero".

**Authorize once** — writes require an API key, cached at
`~/.config/zotero-skill/local-api-key` (mode 600; override with `--api-key` or
`$ZOTERO_LOCAL_API_KEY`):

```bash
python3 ~/.pi/agent/skills/zotero/scripts/zotero-write.py authorize
```

### Commands

| Command | Description |
|---------|-------------|
| `ping` | Check the API; print server id + library version |
| `authorize [--app-name N] [--force]` | Obtain + cache a local API key |
| `collections` | List collections (key, name, parent, item count) |
| `create-collection NAME [--parent REF]` | Create a (sub)collection |
| `move KEY... --to REF [--from REF] [--dry-run]` | Add items to a collection; with `--from`, also remove them from it |
| `move-collection --from REF --to REF [--except KEY...] [--create-target] [--parent REF] [--dry-run]` | Move every item of one collection into another |

- `REF` is a collection **name** (case-insensitive) or an 8-char **key**.
- `--except` takes itemKeys to leave behind.
- `--create-target` creates the target (optionally under `--parent`) if missing.
- Always JSON output; `--dry-run` previews without writing.

### Notes

- **Move = add + remove.** An item may live in several collections; Zotero has no
  single-parent ownership, so a "move" is: add to target, remove from source.
- Writes are guarded with `If-Unmodified-Since-Version`; a concurrent edit gives
  HTTP 412, which the script retries once after re-reading the version.
- Reads (`ping`, `collections`) work without a key; only writes need one.
- **Freshness:** search reads the SQLite file with `immutable=1` and therefore
  ignores Zotero's WAL. Right after a write, search may briefly show the old
  state until Zotero checkpoints the WAL (e.g. on quit). Trust the write
  script / `collections` for the current state.

### Example — organize a conference collection

```bash
W=~/.pi/agent/skills/zotero/scripts/zotero-write.py
# preview: move all of "infra" into a new "MLSYS26", keeping two overviews
python3 $W move-collection --from infra --to MLSYS26 \
    --parent infra --create-target --except F482FXCD VZ4ATNX4 --dry-run
# execute
python3 $W move-collection --from infra --to MLSYS26 \
    --parent infra --create-target --except F482FXCD VZ4ATNX4
```

## Instructions

### 1. Intent Mapping

Map user requests to search modes:

- "find/search + keywords" -> `search`
- "papers by [author]" -> `author`
- "what's in [collection]" -> `collection`
- "recently added" -> `recent`
- "tagged with X" -> `tag`
- "do I have this DOI" -> `doi`
- "paper mentions X" / "body text contains X" -> `fulltext`
- Unsure -> default to `search`

### 2. Search Execution

Run the command, get JSON results.

**Strategy**:
- `search` mode auto-ranks by relevance (phrase match > whole word > substring), output includes `relevance` score
- **Two-stage retrieval**: use `--compact` first to scan results, then `get KEY1 KEY2 ...` to fetch full details for selected items
- For compound terms (e.g. "Neural ODE"), if `search` is noisy, supplement with `fulltext` (exact word match, less noise)

### 3. Fallback

`search` returns nothing -> auto-try `fulltext` (keywords may appear in PDF body, not title/abstract).

### 4. Result Presentation

- **1-3 results**: Show full info (title, authors, year, journal, abstract excerpt, DOI, zoteroURI)
- **4-10 results**: Title + authors + year list, offer to expand
- **10+ results**: Show count + title list, suggest narrowing query
- Always include `zoteroURI` (clickable link to open in Zotero)

### 5. Writing Assistance

When the user is writing a paper/document:
- Proactively provide citation format: `(Author, Year)`
- Include DOI for cross-referencing
- If abstract available, briefly summarize the paper's key contribution

### 6. Combined Queries

No complex SQL needed. For "papers by [author] about [topic]":
- Run `search "topic keywords"`
- Filter results by matching the author field in returned JSON

### Notes

- `fulltext` is **exact word match** (no phrases, no fuzzy, no stemming), multi-word = AND
- Tag coverage varies by library; not the primary search method
- Some items may lack abstracts — this is normal
