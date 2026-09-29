#!/usr/bin/env python3
"""Zotero local library search

Usage:
  zotero-search.py <mode> <query> [options]

Modes:
  search "keywords"        Keyword search (title + abstract + journal + notes)
  fulltext "word1 word2"   PDF full-text search (inverted index, exact words, AND semantics)
  author "name"            Search by author name
  collection list          List all collections
  collection "name"        Browse collection contents
  recent [--days N]        Recently added items (default: 30 days)
  tag list                 List all tags
  tag "name"               Search by tag
  doi "10.xxxx/..."        Exact DOI lookup
  get KEY1 [KEY2 ...]      Batch fetch details by itemKey

Global options:
  --limit N                Max results (default: 20)
  --type TYPE              Filter by item type
  --db PATH                Override database path
"""

import argparse
import json
import os
import re
import sqlite3
import sys
import time
from pathlib import Path

DEFAULT_DB = Path.home() / "zotero" / "zotero.sqlite"
DEFAULT_LIMIT = 20
EXCLUDED_TYPES = ("attachment", "note", "annotation")

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

ITEM_META_CTE = """
WITH item_meta AS (
    SELECT
        i.itemID,
        i.key AS itemKey,
        it.typeName,
        i.dateAdded,
        MAX(CASE WHEN f.fieldName = 'title' THEN idv.value END) AS title,
        MAX(CASE WHEN f.fieldName = 'abstractNote' THEN idv.value END) AS abstract,
        MAX(CASE WHEN f.fieldName = 'date' THEN idv.value END) AS date,
        MAX(CASE WHEN f.fieldName = 'DOI' THEN idv.value END) AS doi,
        MAX(CASE WHEN f.fieldName = 'url' THEN idv.value END) AS url,
        MAX(CASE WHEN f.fieldName = 'publicationTitle' THEN idv.value END) AS publication,
        MAX(CASE WHEN f.fieldName = 'volume' THEN idv.value END) AS volume,
        MAX(CASE WHEN f.fieldName = 'pages' THEN idv.value END) AS pages,
        MAX(CASE WHEN f.fieldName = 'issue' THEN idv.value END) AS issue
    FROM items i
    JOIN itemTypes it ON i.itemTypeID = it.itemTypeID
    LEFT JOIN itemData id ON i.itemID = id.itemID
    LEFT JOIN fields f ON id.fieldID = f.fieldID
    LEFT JOIN itemDataValues idv ON id.valueID = idv.valueID
    WHERE i.itemID NOT IN (SELECT itemID FROM deletedItems)
      AND it.typeName NOT IN ({excluded})
    GROUP BY i.itemID
)
""".format(excluded=", ".join(f"'{t}'" for t in EXCLUDED_TYPES))


def open_db(db_path):
    """Open Zotero DB read-only with immutable=1 to bypass locks."""
    path = str(db_path)
    if not os.path.exists(path):
        print(json.dumps({
            "status": "error",
            "error": f"Database not found: {path}"
        }))
        sys.exit(1)

    uri = f"file:{path}?mode=ro&immutable=1"
    try:
        conn = sqlite3.connect(uri, uri=True)
        conn.row_factory = sqlite3.Row
        conn.execute("SELECT 1 FROM items LIMIT 1")
        return conn
    except sqlite3.DatabaseError:
        # Rare: caught mid-write. Wait briefly and retry once.
        time.sleep(0.5)
        try:
            conn = sqlite3.connect(uri, uri=True)
            conn.row_factory = sqlite3.Row
            conn.execute("SELECT 1 FROM items LIMIT 1")
            return conn
        except sqlite3.DatabaseError as e:
            print(json.dumps({
                "status": "error",
                "error": f"Cannot open database: {e}"
            }))
            sys.exit(1)


# ---------------------------------------------------------------------------
# Enrichment (batch sub-queries after primary search)
# ---------------------------------------------------------------------------

def _in_clause(ids):
    """Build (?, ?, ...) placeholder and params for IN clause."""
    return f"({', '.join('?' for _ in ids)})", list(ids)


def attach_authors(conn, item_ids):
    """Return {itemID: "Author1; Author2"} for given IDs."""
    if not item_ids:
        return {}
    ph, params = _in_clause(item_ids)
    rows = conn.execute(f"""
        SELECT ic.itemID,
               GROUP_CONCAT(
                   CASE WHEN c.firstName IS NOT NULL AND c.firstName != ''
                        THEN c.lastName || ', ' || c.firstName
                        ELSE c.lastName
                   END, '; '
               ) AS authors
        FROM itemCreators ic
        JOIN creators c ON ic.creatorID = c.creatorID
        WHERE ic.itemID IN {ph}
        GROUP BY ic.itemID
    """, params).fetchall()
    return {r["itemID"]: r["authors"] for r in rows}


def attach_tags(conn, item_ids):
    """Return {itemID: "tag1; tag2"} for given IDs."""
    if not item_ids:
        return {}
    ph, params = _in_clause(item_ids)
    rows = conn.execute(f"""
        SELECT it.itemID, GROUP_CONCAT(t.name, '; ') AS tags
        FROM itemTags it
        JOIN tags t ON it.tagID = t.tagID
        WHERE it.itemID IN {ph}
        GROUP BY it.itemID
    """, params).fetchall()
    return {r["itemID"]: r["tags"] for r in rows}


def attach_collections(conn, item_ids):
    """Return {itemID: "col1; col2"} for given IDs."""
    if not item_ids:
        return {}
    ph, params = _in_clause(item_ids)
    rows = conn.execute(f"""
        SELECT ci.itemID, GROUP_CONCAT(c.collectionName, '; ') AS collections
        FROM collectionItems ci
        JOIN collections c ON ci.collectionID = c.collectionID
        WHERE ci.itemID IN {ph}
        GROUP BY ci.itemID
    """, params).fetchall()
    return {r["itemID"]: r["collections"] for r in rows}


def attach_notes(conn, item_ids):
    """Return {itemID: "note text"} for given IDs (HTML stripped)."""
    if not item_ids:
        return {}
    ph, params = _in_clause(item_ids)
    rows = conn.execute(f"""
        SELECT parentItemID AS itemID,
               GROUP_CONCAT(note, ' ') AS notes
        FROM itemNotes
        WHERE parentItemID IN {ph}
        GROUP BY parentItemID
    """, params).fetchall()
    result = {}
    for r in rows:
        text = re.sub(r'<[^>]+>', '', r["notes"] or "")
        text = re.sub(r'\s+', ' ', text).strip()
        if text:
            result[r["itemID"]] = text
    return result


def check_fulltext(conn, item_ids):
    """Return {itemID: True} for items that have full-text indexed."""
    if not item_ids:
        return {}
    ph, params = _in_clause(item_ids)
    # fulltextItems stores attachment itemIDs, need to map to parent
    rows = conn.execute(f"""
        SELECT DISTINCT COALESCE(ia.parentItemID, fi.itemID) AS itemID
        FROM fulltextItems fi
        LEFT JOIN itemAttachments ia ON fi.itemID = ia.itemID
        WHERE COALESCE(ia.parentItemID, fi.itemID) IN {ph}
    """, params).fetchall()
    return {r["itemID"]: True for r in rows}


def enrich(conn, items):
    """Attach authors, tags, collections, notes, fulltext status to items."""
    if not items:
        return items
    ids = [it["itemID"] for it in items]
    authors = attach_authors(conn, ids)
    tags = attach_tags(conn, ids)
    collections = attach_collections(conn, ids)
    notes = attach_notes(conn, ids)
    ft = check_fulltext(conn, ids)

    for it in items:
        iid = it["itemID"]
        it["authors"] = authors.get(iid)
        it["tags"] = tags.get(iid)
        it["collections"] = collections.get(iid)
        it["notes"] = notes.get(iid)
        it["hasFulltext"] = ft.get(iid, False)
        it["hasNotes"] = iid in notes
        it["zoteroURI"] = f"zotero://select/library/items/{it['itemKey']}"
    return items


def _clean_date(date_str):
    """Deduplicate dates like '2023-11-30 2023-11-30'."""
    if not date_str:
        return date_str
    parts = date_str.strip().split()
    if len(parts) >= 2 and parts[0] == parts[1]:
        return parts[0]
    return date_str


def _row_to_dict(row):
    """Convert sqlite3.Row to dict with cleaned fields."""
    d = dict(row)
    d["date"] = _clean_date(d.get("date"))
    # Remove internal fields
    d.pop("_raw_notes", None)
    return d


# ---------------------------------------------------------------------------
# Relevance scoring
# ---------------------------------------------------------------------------

def _word_match(text, word):
    """Check if word appears as a whole word (not substring) in text."""
    if not text:
        return False
    return bool(re.search(r'\b' + re.escape(word) + r'\b', text, re.IGNORECASE))


def _score_relevance(items, query):
    """Score and sort search results by relevance.

    Scoring hierarchy: phrase in title >> word in title >> phrase in abstract
    >> word in abstract >> substring only. Pushes noise (e.g. 'ode' inside
    'model') to the bottom.
    """
    keywords = query.lower().split()
    phrase = query.lower().strip()
    multi_word = len(keywords) > 1

    for item in items:
        score = 0
        title = (item.get('title') or '').lower()
        abstract = (item.get('abstract') or '').lower()
        authors = (item.get('_authors_text') or '').lower()
        raw_notes = item.get('_raw_notes') or ''
        if raw_notes:
            raw_notes = re.sub(r'<[^>]+>', '', raw_notes).lower()

        # Phrase match bonus (multi-word queries only)
        if multi_word:
            if phrase in title:
                score += 200
            if phrase in abstract:
                score += 60
            if phrase in raw_notes:
                score += 20

        # Per-keyword scoring
        for kw in keywords:
            # Title (highest weight)
            if _word_match(title, kw):
                score += 40
            elif kw in title:
                score += 10

            # Abstract
            if _word_match(abstract, kw):
                score += 15
            elif kw in abstract:
                score += 3

            # Authors
            if authors:
                if _word_match(authors, kw):
                    score += 20
                elif kw in authors:
                    score += 8

            # Notes
            if raw_notes:
                if _word_match(raw_notes, kw):
                    score += 5
                elif kw in raw_notes:
                    score += 1

        item['_relevance'] = score

    items.sort(key=lambda x: (-x.get('_relevance', 0), x.get('dateAdded') or ''))
    return items


# ---------------------------------------------------------------------------
# Query functions
# ---------------------------------------------------------------------------

def search_metadata(conn, query, item_type=None, limit=DEFAULT_LIMIT):
    """Keyword search across title, abstract, publication, notes.
    Results are scored by relevance and sorted accordingly."""
    keywords = query.lower().split()
    if not keywords:
        return []

    # Build conditions for searching (title, abstract, publication, notes, authors)
    conditions = []
    params = []
    for kw in keywords:
        kw_pattern = f"%{kw}%"
        conditions.append("""(
            LOWER(m.title) LIKE ? OR
            LOWER(m.abstract) LIKE ? OR
            LOWER(m.publication) LIKE ? OR
            LOWER(COALESCE(n.notes, '')) LIKE ? OR
            LOWER(COALESCE(a.authors_text, '')) LIKE ?
        )""")
        params.extend([kw_pattern] * 5)

    type_clause = ""
    if item_type:
        type_clause = "AND m.typeName = ?"
        params.append(item_type)

    # Fetch extra results for relevance reranking (min 100 to avoid
    # missing relevant older papers when user limit is small)
    fetch_limit = max(limit * 5, 100)
    params.append(fetch_limit)

    sql = f"""
    {ITEM_META_CTE},
    item_notes AS (
        SELECT parentItemID AS itemID,
               GROUP_CONCAT(note, ' ') AS notes
        FROM itemNotes
        WHERE parentItemID IS NOT NULL
        GROUP BY parentItemID
    ),
    item_authors AS (
        SELECT ic.itemID,
               GROUP_CONCAT(
                   CASE WHEN c.firstName IS NOT NULL AND c.firstName != ''
                        THEN c.lastName || ' ' || c.firstName
                        ELSE c.lastName
                   END, '; '
               ) AS authors_text
        FROM itemCreators ic
        JOIN creators c ON ic.creatorID = c.creatorID
        GROUP BY ic.itemID
    )
    SELECT m.*, n.notes AS _raw_notes, a.authors_text AS _authors_text
    FROM item_meta m
    LEFT JOIN item_notes n ON m.itemID = n.itemID
    LEFT JOIN item_authors a ON m.itemID = a.itemID
    WHERE {' AND '.join(conditions)}
    {type_clause}
    ORDER BY m.dateAdded DESC
    LIMIT ?
    """
    rows = conn.execute(sql, params).fetchall()

    # Convert rows, preserving raw notes and authors for scoring
    items = []
    for r in rows:
        rd = dict(r)
        raw_notes = rd.get('_raw_notes', '')
        authors_text = rd.get('_authors_text', '')
        d = _row_to_dict(r)
        d['_raw_notes'] = raw_notes
        d['_authors_text'] = authors_text
        items.append(d)

    # Score by relevance
    items = _score_relevance(items, query)

    # Clean up internal fields, expose relevance score
    for item in items:
        item.pop('_raw_notes', None)
        item.pop('_authors_text', None)
        item['relevance'] = item.pop('_relevance', 0)

    return items[:limit]


def search_fulltext(conn, query, item_type=None, limit=DEFAULT_LIMIT):
    """Full-text search using Zotero's inverted word index.
    Results are scored by metadata relevance (title/abstract) and sorted."""
    words = [w.lower() for w in query.split() if w.strip()]
    if not words:
        return []

    ph = ", ".join("?" for _ in words)
    params = list(words) + [len(words)]

    type_clause = ""
    type_params = []
    if item_type:
        type_clause = "AND m.typeName = ?"
        type_params.append(item_type)

    # Fetch extra results for relevance reranking
    fetch_limit = max(limit * 3, 60)

    sql = f"""
    {ITEM_META_CTE}
    SELECT m.*
    FROM item_meta m
    WHERE m.itemID IN (
        SELECT COALESCE(ia.parentItemID, fiw.itemID) AS parentID
        FROM fulltextWords fw
        JOIN fulltextItemWords fiw ON fw.wordID = fiw.wordID
        LEFT JOIN itemAttachments ia ON fiw.itemID = ia.itemID
        WHERE LOWER(fw.word) IN ({ph})
        GROUP BY parentID
        HAVING COUNT(DISTINCT fw.word) = ?
    )
    {type_clause}
    ORDER BY m.dateAdded DESC
    LIMIT ?
    """
    all_params = params + type_params + [fetch_limit]
    rows = conn.execute(sql, all_params).fetchall()
    items = [_row_to_dict(r) for r in rows]

    # Score by metadata relevance (title/abstract) so papers where the
    # query terms also appear in metadata rank higher
    items = _score_relevance(items, query)
    for item in items:
        item.pop('_raw_notes', None)
        item.pop('_authors_text', None)
        item['relevance'] = item.pop('_relevance', 0)

    return items[:limit]


def search_author(conn, name, item_type=None, limit=DEFAULT_LIMIT):
    """Search by author name (partial match on first or last name)."""
    pattern = f"%{name.lower()}%"
    type_clause = ""
    params = [pattern, pattern]
    if item_type:
        type_clause = "AND m.typeName = ?"
        params.append(item_type)
    params.append(limit)

    sql = f"""
    {ITEM_META_CTE}
    SELECT DISTINCT m.*
    FROM item_meta m
    JOIN itemCreators ic ON m.itemID = ic.itemID
    JOIN creators c ON ic.creatorID = c.creatorID
    WHERE (LOWER(c.lastName) LIKE ? OR LOWER(c.firstName) LIKE ?)
    {type_clause}
    ORDER BY m.dateAdded DESC
    LIMIT ?
    """
    rows = conn.execute(sql, params).fetchall()
    return [_row_to_dict(r) for r in rows]


def browse_collection(conn, name, item_type=None, limit=DEFAULT_LIMIT):
    """List items in a collection by name (case-insensitive)."""
    type_clause = ""
    params = [name.lower()]
    if item_type:
        type_clause = "AND m.typeName = ?"
        params.append(item_type)
    params.append(limit)

    sql = f"""
    {ITEM_META_CTE}
    SELECT m.*
    FROM item_meta m
    JOIN collectionItems ci ON m.itemID = ci.itemID
    JOIN collections c ON ci.collectionID = c.collectionID
    WHERE LOWER(c.collectionName) = ?
    {type_clause}
    ORDER BY m.dateAdded DESC
    LIMIT ?
    """
    rows = conn.execute(sql, params).fetchall()

    # Also check for standalone attachments in the collection
    att_sql = """
    SELECT
        i.itemID, i.key AS itemKey, it.typeName, i.dateAdded,
        MAX(CASE WHEN f.fieldName = 'title' THEN idv.value END) AS title,
        NULL AS abstract, NULL AS date, NULL AS doi, NULL AS url,
        NULL AS publication, NULL AS volume, NULL AS pages, NULL AS issue
    FROM items i
    JOIN itemTypes it ON i.itemTypeID = it.itemTypeID
    JOIN collectionItems ci ON i.itemID = ci.itemID
    JOIN collections c ON ci.collectionID = c.collectionID
    LEFT JOIN itemData id ON i.itemID = id.itemID
    LEFT JOIN fields f ON id.fieldID = f.fieldID
    LEFT JOIN itemDataValues idv ON id.valueID = idv.valueID
    WHERE LOWER(c.collectionName) = ?
      AND it.typeName = 'attachment'
      AND i.itemID NOT IN (SELECT itemID FROM deletedItems)
    GROUP BY i.itemID
    ORDER BY i.dateAdded DESC
    """
    att_rows = conn.execute(att_sql, [name.lower()]).fetchall()

    results = [_row_to_dict(r) for r in rows]
    results.extend(_row_to_dict(r) for r in att_rows)
    return results[:limit] if limit else results


def list_collections(conn):
    """List all collections with hierarchy and item counts."""
    rows = conn.execute("""
        SELECT c.collectionID, c.collectionName,
               pc.collectionName AS parentName,
               (SELECT COUNT(*) FROM collectionItems ci
                WHERE ci.collectionID = c.collectionID) AS itemCount
        FROM collections c
        LEFT JOIN collections pc ON c.parentCollectionID = pc.collectionID
        ORDER BY c.parentCollectionID NULLS FIRST, c.collectionName
    """).fetchall()
    return [dict(r) for r in rows]


def recent_items(conn, days=30, item_type=None, limit=DEFAULT_LIMIT):
    """Items added in the last N days."""
    type_clause = ""
    params = [f"-{days} days"]
    if item_type:
        type_clause = "AND m.typeName = ?"
        params.append(item_type)
    params.append(limit)

    sql = f"""
    {ITEM_META_CTE}
    SELECT m.*
    FROM item_meta m
    WHERE m.dateAdded >= datetime('now', ?)
    {type_clause}
    ORDER BY m.dateAdded DESC
    LIMIT ?
    """
    rows = conn.execute(sql, params).fetchall()
    return [_row_to_dict(r) for r in rows]


def search_tag(conn, tag_name, item_type=None, limit=DEFAULT_LIMIT):
    """Search items by tag name (case-insensitive)."""
    type_clause = ""
    params = [tag_name.lower()]
    if item_type:
        type_clause = "AND m.typeName = ?"
        params.append(item_type)
    params.append(limit)

    sql = f"""
    {ITEM_META_CTE}
    SELECT m.*
    FROM item_meta m
    JOIN itemTags it ON m.itemID = it.itemID
    JOIN tags t ON it.tagID = t.tagID
    WHERE LOWER(t.name) = ?
    {type_clause}
    ORDER BY m.dateAdded DESC
    LIMIT ?
    """
    rows = conn.execute(sql, params).fetchall()
    return [_row_to_dict(r) for r in rows]


def list_tags(conn):
    """List all tags with usage counts."""
    rows = conn.execute("""
        SELECT t.name, COUNT(it.itemID) AS count
        FROM tags t
        JOIN itemTags it ON t.tagID = it.tagID
        GROUP BY t.tagID
        ORDER BY count DESC
    """).fetchall()
    return [dict(r) for r in rows]


def lookup_doi(conn, doi_str):
    """Exact DOI lookup."""
    sql = f"""
    {ITEM_META_CTE}
    SELECT m.*
    FROM item_meta m
    WHERE LOWER(m.doi) = LOWER(?)
    LIMIT 1
    """
    rows = conn.execute(sql, [doi_str]).fetchall()
    return [_row_to_dict(r) for r in rows]


def get_by_keys(conn, keys):
    """Fetch items by one or more itemKeys. Returns results in the same order as input keys."""
    if not keys:
        return []
    ph, params = _in_clause(keys)
    sql = f"""
    {ITEM_META_CTE}
    SELECT m.*
    FROM item_meta m
    WHERE m.itemKey IN {ph}
    """
    rows = conn.execute(sql, params).fetchall()
    items_by_key = {_row_to_dict(r)['itemKey']: _row_to_dict(r) for r in rows}
    return [items_by_key[k] for k in keys if k in items_by_key]


# ---------------------------------------------------------------------------
# Output formatting
# ---------------------------------------------------------------------------

COMPACT_FIELDS = {
    'itemKey', 'typeName', 'title', 'authors', 'date',
    'publication', 'relevance', 'zoteroURI',
}


def format_output(results, query_info, is_list=False, compact=False):
    """Format results as JSON for Claude consumption."""
    if compact and not is_list:
        results = [
            {k: v for k, v in r.items() if k in COMPACT_FIELDS and v is not None}
            for r in results
        ]

    if is_list:
        return json.dumps({
            "status": "ok",
            "query": query_info,
            "count": len(results),
            "items": results
        }, ensure_ascii=False, indent=2)

    return json.dumps({
        "status": "ok",
        "query": query_info,
        "count": len(results),
        "results": results
    }, ensure_ascii=False, indent=2)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def build_parser():
    parser = argparse.ArgumentParser(
        description="Search local Zotero library",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    sub = parser.add_subparsers(dest="mode", required=True)

    # search
    p = sub.add_parser("search", help="Keyword search (title, abstract, publication, notes)")
    p.add_argument("query", help="Search keywords")

    # fulltext
    p = sub.add_parser("fulltext", help="Full-text PDF content search")
    p.add_argument("query", help="Words to search (AND semantics)")

    # author
    p = sub.add_parser("author", help="Search by author name")
    p.add_argument("name", help="Author name (partial match)")

    # collection
    p = sub.add_parser("collection", help="Browse collection or list all")
    p.add_argument("name", nargs="?", default="list",
                   help='Collection name, or "list" to show all')

    # recent
    p = sub.add_parser("recent", help="Recently added items")
    p.add_argument("--days", type=int, default=30, help="Number of days (default: 30)")

    # tag
    p = sub.add_parser("tag", help="Search by tag or list all tags")
    p.add_argument("name", nargs="?", default="list",
                   help='Tag name, or "list" to show all')

    # doi
    p = sub.add_parser("doi", help="Exact DOI lookup")
    p.add_argument("identifier", help="DOI string")

    # get
    p = sub.add_parser("get", help="Fetch items by itemKey(s)")
    p.add_argument("keys", nargs="+", help="One or more itemKeys")

    # Global options for all subparsers
    for sp in sub.choices.values():
        sp.add_argument("--limit", type=int, default=DEFAULT_LIMIT,
                        help=f"Max results (default: {DEFAULT_LIMIT})")
        sp.add_argument("--type", dest="item_type", default=None,
                        help="Filter by item type (e.g., journalArticle, book)")
        sp.add_argument("--compact", action="store_true", default=False,
                        help="Compact output (title, authors, year, publication only)")
        sp.add_argument("--db", default=str(DEFAULT_DB),
                        help=f"Database path (default: {DEFAULT_DB})")

    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()

    conn = open_db(args.db)

    try:
        mode = args.mode
        limit = args.limit
        item_type = args.item_type
        compact = args.compact

        if mode == "search":
            items = search_metadata(conn, args.query, item_type, limit)
            items = enrich(conn, items)
            query_info = {"mode": "search", "terms": args.query, "limit": limit}
            if item_type:
                query_info["type"] = item_type
            if not items:
                query_info["suggestion"] = "Try 'fulltext' mode to search within PDF content."
            print(format_output(items, query_info, compact=compact))

        elif mode == "fulltext":
            items = search_fulltext(conn, args.query, item_type, limit)
            items = enrich(conn, items)
            query_info = {"mode": "fulltext", "words": args.query.split(), "limit": limit}
            if item_type:
                query_info["type"] = item_type
            if not items:
                query_info["suggestion"] = "Fulltext index covers ~47% of items. Try 'search' mode for metadata."
            print(format_output(items, query_info, compact=compact))

        elif mode == "author":
            items = search_author(conn, args.name, item_type, limit)
            items = enrich(conn, items)
            query_info = {"mode": "author", "name": args.name, "limit": limit}
            if item_type:
                query_info["type"] = item_type
            print(format_output(items, query_info, compact=compact))

        elif mode == "collection":
            if args.name == "list":
                colls = list_collections(conn)
                print(format_output(colls, {"mode": "collection", "subcommand": "list"}, is_list=True, compact=compact))
            else:
                items = browse_collection(conn, args.name, item_type, limit)
                items = enrich(conn, items)
                query_info = {"mode": "collection", "name": args.name, "limit": limit}
                if item_type:
                    query_info["type"] = item_type
                print(format_output(items, query_info, compact=compact))

        elif mode == "recent":
            items = recent_items(conn, args.days, item_type, limit)
            items = enrich(conn, items)
            query_info = {"mode": "recent", "days": args.days, "limit": limit}
            if item_type:
                query_info["type"] = item_type
            print(format_output(items, query_info, compact=compact))

        elif mode == "tag":
            if args.name == "list":
                tags = list_tags(conn)
                print(format_output(tags, {"mode": "tag", "subcommand": "list"}, is_list=True, compact=compact))
            else:
                items = search_tag(conn, args.name, item_type, limit)
                items = enrich(conn, items)
                query_info = {"mode": "tag", "name": args.name, "limit": limit}
                if item_type:
                    query_info["type"] = item_type
                print(format_output(items, query_info, compact=compact))

        elif mode == "doi":
            items = lookup_doi(conn, args.identifier)
            items = enrich(conn, items)
            query_info = {"mode": "doi", "identifier": args.identifier}
            print(format_output(items, query_info, compact=compact))

        elif mode == "get":
            items = get_by_keys(conn, args.keys)
            items = enrich(conn, items)
            query_info = {"mode": "get", "keys": args.keys}
            print(format_output(items, query_info, compact=compact))

    finally:
        conn.close()


if __name__ == "__main__":
    main()
