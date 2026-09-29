# zotero-skill

A Claude Code skill for searching your local Zotero library. One Python file, zero dependencies, no server process.

## Why not MCP?

There are 10+ Zotero MCP servers out there. They require you to install dependencies, run a persistent server process, and inject protocol metadata into your context window. Some even need you to run embedding models and build a vector index — then you get results ranked by reasons you can't inspect.

This skill takes the opposite approach:

| | MCP servers | This skill |
|---|---|---|
| Dependencies | pip/npm + embedding models + MCP runtime | **Python stdlib only** |
| Token overhead | MCP protocol wrapping + tool descriptions in context | **Direct bash call, output = result** |
| Search method | Vector similarity (build index first) | **Deterministic ranking + Zotero's native inverted index** |
| Install | pip + setup + configure AI client | **Copy folder, done** |
| Architecture | Persistent server process | **On-demand, exits after each call** |
| Works with | Claude Desktop / specific MCP clients | **Anything that can run bash** |

## Features

- **Keyword search** — title, abstract, journal, authors, notes with relevance scoring
- **Fulltext search** — PDF body text via Zotero's own inverted word index (no external indexing)
- **Author / Tag / Collection / DOI / Recent** — all the lookup modes you'd expect
- **Two-stage retrieval** — `--compact` for scanning, `get` for details (controls token budget)
- **Deterministic relevance** — phrase match > whole word > substring. You can see why result #1 is #1
- **Read-only** — opens SQLite with `immutable=1`, safe to run while Zotero is open

## Requirements

- Python 3.8+
- Zotero desktop (for the `zotero.sqlite` database)
- An AI tool that can run shell commands (Claude Code, Cursor, Windsurf, etc.)

## Install

1. Copy the skill into your Claude Code skills directory:

```bash
# Clone
git clone https://github.com/YOUR_USERNAME/zotero-skill.git

# Copy to Claude Code skills
cp -r zotero-skill/.claude/skills/zotero ~/.claude/skills/zotero
```

Or simply copy the `SKILL.md` and `scripts/` folder into `~/.claude/skills/zotero/`.

2. **Verify your database path.** The default is `~/Zotero/zotero.sqlite` (standard macOS/Linux). If your Zotero data is elsewhere (e.g., Windows: `C:\Users\<you>\Zotero\zotero.sqlite`), either:
   - Edit `DEFAULT_DB` in `scripts/zotero-search.py`, or
   - Use `--db /your/path/zotero.sqlite` on each call

3. That's it. No pip install, no server to start, no API keys.

## Usage

### Direct CLI

```bash
# Keyword search
python3 scripts/zotero-search.py search "transformer attention"

# Search PDF body text
python3 scripts/zotero-search.py fulltext "backpropagation"

# By author
python3 scripts/zotero-search.py author "Hinton"

# Recent additions
python3 scripts/zotero-search.py recent --days 7

# Compact output (less tokens)
python3 scripts/zotero-search.py search "diffusion model" --compact

# Get full details for specific items
python3 scripts/zotero-search.py get ABC12345 DEF67890

# DOI lookup
python3 scripts/zotero-search.py doi "10.1038/s41586-021-03819-2"

# Browse collections
python3 scripts/zotero-search.py collection list
python3 scripts/zotero-search.py collection "Machine Learning"
```

### As a Claude Code Skill

Once installed, just talk naturally:

- "Search my Zotero for papers about graph neural networks"
- "Do I have anything by Vaswani?"
- "What did I add this week?"
- "Find the paper with DOI 10.xxxx/..."

The skill handles intent mapping, search execution, and result formatting automatically.

## How It Works

Reads Zotero's SQLite database directly (`mode=ro&immutable=1` — safe, no locks). No intermediate server, no API, no network calls.

- **Keyword search**: SQL LIKE across title + abstract + journal + authors + notes, then re-ranked by a deterministic scoring function (phrase > whole word > substring)
- **Fulltext search**: Queries Zotero's built-in `fulltextWords` / `fulltextItemWords` tables (the same inverted index Zotero uses internally), then re-ranked by metadata relevance
- **Enrichment**: After primary search, batch-attaches authors, tags, collections, notes, and fulltext status in one pass

## Output Format

JSON with structured fields. Example (compact mode):

```json
{
  "status": "ok",
  "query": {"mode": "search", "terms": "attention mechanism", "limit": 20},
  "count": 3,
  "results": [
    {
      "itemKey": "ABC12345",
      "title": "Attention Is All You Need",
      "authors": "Vaswani, Ashish; Shazeer, Noam; ...",
      "date": "2017",
      "publication": "NeurIPS",
      "relevance": 240,
      "zoteroURI": "zotero://select/library/items/ABC12345"
    }
  ]
}
```

## FAQ

**Q: Does this work while Zotero is open?**
A: Yes. It opens the database with `immutable=1`, completely bypassing file locks.

**Q: Why not use semantic/vector search?**
A: Current embedding models produce too much noise for academic literature retrieval. Deterministic keyword + fulltext search with proper relevance scoring is more predictable and inspectable. If you disagree, there are more than 10 MCP servers waiting for you.

**Q: Can this modify my Zotero library?**
A: No. Read-only access, enforced at the SQLite connection level.

**Q: What about Zotero's Web API?**
A: This skill is local-only by design. No network calls, no API keys, no cloud dependency. Your library data stays on your machine.

## License

MIT
