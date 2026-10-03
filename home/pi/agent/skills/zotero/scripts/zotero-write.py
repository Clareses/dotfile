#!/usr/bin/env python3
"""Zotero local library WRITE operations (create collections, move items).

Talks to the Zotero desktop app over its Local HTTP API. This is the write
counterpart to zotero-search.py (which is read-only SQLite search).

Requirements
------------
Zotero desktop must be running with the local API enabled:
    Settings -> Advanced -> "Allow other applications on this computer to
    communicate with Zotero"

Writes need an API key. The first time, run:

    zotero-write.py authorize

Zotero may pop a confirmation; the returned key is cached at
    ~/.config/zotero-skill/local-api-key   (chmod 600)
Override with --api-key or $ZOTERO_LOCAL_API_KEY.

Usage
-----
  zotero-write.py ping
  zotero-write.py authorize [--app-name NAME] [--force]
  zotero-write.py collections
  zotero-write.py create-collection NAME [--parent REF]
  zotero-write.py move KEY [KEY ...] --to REF [--from REF] [--dry-run]
  zotero-write.py move-collection --from REF --to REF
                              [--except KEY ...] [--create-target]
                              [--parent REF] [--dry-run]

REF is either a collection name (case-insensitive) or an 8-char collection key.

Notes
-----
* "Move" = add the item to the target collection and (with --from / for
  move-collection) remove it from the source. An item can live in several
  collections; Zotero has no single-parent ownership.
* Every write sends If-Unmodified-Since-Version for optimistic locking; a 412
  is retried once by re-fetching the current version.
* All output is JSON.
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

API_VERSION = "3"
DEFAULT_BASE = os.environ.get(
    "ZOTERO_LOCAL_API_URL", "http://127.0.0.1:23119/api/users/0"
)
DEFAULT_APP_NAME = "zotero-skill"
PAGE_LIMIT = 100
KEY_LEN = 8


# ---------------------------------------------------------------------------
# API key cache
# ---------------------------------------------------------------------------

def _config_dir():
    base = os.environ.get("XDG_CONFIG_HOME") or str(Path.home() / ".config")
    return Path(base) / "zotero-skill"


KEY_FILE = _config_dir() / "local-api-key"


def load_key():
    if os.environ.get("ZOTERO_LOCAL_API_KEY"):
        return os.environ["ZOTERO_LOCAL_API_KEY"]
    try:
        key = KEY_FILE.read_text().strip()
        return key or None
    except OSError:
        return None


def save_key(key):
    KEY_FILE.parent.mkdir(parents=True, exist_ok=True)
    KEY_FILE.write_text(key + "\n")
    try:
        os.chmod(KEY_FILE, 0o600)
    except OSError:
        pass


# ---------------------------------------------------------------------------
# Local API client
# ---------------------------------------------------------------------------

def _is_collection_key(ref):
    return (
        isinstance(ref, str)
        and len(ref) == KEY_LEN
        and ref.isalnum()
        and ref.upper() == ref
    )


class ApiError(Exception):
    def __init__(self, status, body):
        self.status = status
        self.body = body
        super().__init__(body or f"HTTP {status}")


class LocalAPI:
    def __init__(self, base=DEFAULT_BASE, api_key=None):
        self.base = base.rstrip("/")
        self.api_key = api_key
        self._server_id = None

    # -- low level ---------------------------------------------------------
    def _headers(self, umsv=None, auth=False):
        h = {"Zotero-API-Version": API_VERSION, "Content-Type": "application/json"}
        if self._server_id:
            h["Zotero-Server-ID"] = self._server_id
        if auth and self.api_key:
            h["Zotero-API-Key"] = self.api_key
        if umsv is not None:
            h["If-Unmodified-Since-Version"] = str(umsv)
        return h

    def _request(self, method, path, data=None, umsv=None, auth=False):
        url = f"{self.base}{path}"
        body = json.dumps(data).encode() if data is not None else None
        req = urllib.request.Request(
            url, method=method, data=body, headers=self._headers(umsv, auth)
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as f:
                raw = f.read()
                if f.headers.get("Zotero-Server-Id"):
                    self._server_id = f.headers["Zotero-Server-Id"]
                return (json.loads(raw) if raw else None), f.headers
        except urllib.error.HTTPError as e:
            if e.headers and e.headers.get("Zotero-Server-Id"):
                self._server_id = e.headers["Zotero-Server-Id"]
            raise ApiError(e.code, e.read().decode(errors="replace").strip())
        except urllib.error.URLError as e:
            raise ApiError(
                0,
                f"cannot reach the Zotero local API at {self.base} "
                f"({e.reason}). Is Zotero running with the local API enabled?",
            )

    # -- helpers -----------------------------------------------------------
    def _paged(self, path):
        out, start = [], 0
        while True:
            sep = "&" if "?" in path else "?"
            data, headers = self._request("GET", f"{path}{sep}limit={PAGE_LIMIT}&start={start}")
            data = data or []
            out.extend(data)
            total = headers.get("Total-Results")
            if not data or (total is not None and len(out) >= int(total)):
                break
            start += len(data)
        return out

    def library_version(self):
        _, headers = self._request("GET", "/collections?limit=1")
        return int(headers.get("Last-Modified-Version", 0))

    # -- reads -------------------------------------------------------------
    def list_collections(self):
        return self._paged("/collections")

    def collection_items(self, key):
        return self._paged(f"/collections/{key}/items/top")

    def get_item(self, key):
        data, _ = self._request("GET", f"/items/{key}")
        return data[0] if isinstance(data, list) else data

    def resolve_collection(self, ref, parent=None):
        cols = self.list_collections()
        if _is_collection_key(ref):
            for c in cols:
                if c["key"] == ref:
                    return c
            raise ApiError(0, f"no collection with key {ref}")

        matches = [c for c in cols if c["data"]["name"].lower() == ref.lower()]
        if parent is not None:
            pkey = self.resolve_collection(parent)["key"]
            matches = [c for c in matches if c["data"].get("parentCollection") == pkey]
        if not matches:
            hint = f" under parent {parent!r}" if parent else ""
            raise ApiError(0, f"no collection named {ref!r}{hint}")
        if len(matches) > 1:
            keys = ", ".join(f"{c['key']}({c['data']['name']})" for c in matches)
            raise ApiError(0, f"collection name {ref!r} is ambiguous: {keys}")
        return matches[0]

    # -- writes ------------------------------------------------------------
    def authorize(self, app_name):
        # /api/local/authorize lives at the connector root, not under /users/N
        parts = urlsplit(self.base)
        root = urlunsplit((parts.scheme, parts.netloc, "", "", ""))
        # a read first, to learn / verify the server id
        self._request("GET", "/collections?limit=1")
        req = urllib.request.Request(
            root + "/api/local/authorize",
            method="POST",
            data=json.dumps({"appName": app_name}).encode(),
            headers=self._headers(),
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as f:
                return json.loads(f.read()) or {}
        except urllib.error.HTTPError as e:
            raise ApiError(e.code, e.read().decode(errors="replace").strip())

    def create_collection(self, name, parent_key=None):
        payload = {"name": name}
        if parent_key:
            payload["parentCollection"] = parent_key
        body, _ = self._request(
            "POST", "/collections", [payload], umsv=self.library_version(), auth=True
        )
        failed = (body or {}).get("failed", {})
        if failed:
            raise ApiError(0, f"create collection failed: {failed}")
        return body["successful"]["0"]["key"]

    def _patch_collections(self, key, collections, version):
        self._request(
            "PATCH", f"/items/{key}", {"collections": collections}, umsv=version, auth=True
        )

    def move_items(self, keys, to_ref, from_ref=None, dry_run=False):
        target = self.resolve_collection(to_ref)
        source = self.resolve_collection(from_ref) if from_ref else None
        results = self._move_keys(
            keys, target["key"], source["key"] if source else None, dry_run
        )
        return target, source, results

    def _move_keys(self, keys, target_key, source_key, dry_run):
        results = []
        for key in keys:
            try:
                item = self.get_item(key)
            except ApiError as e:
                results.append({"key": key, "status": "error", "error": str(e)})
                continue
            version = item["version"]
            current = list(item["data"].get("collections", []))
            new = [c for c in current if c != source_key] if source_key else list(current)
            if target_key not in new:
                new.append(target_key)

            entry = {
                "key": key,
                "version": version,
                "collections": new,
                "title": (item["data"].get("title") or "")[:80],
            }
            if new == current:
                entry["status"] = "unchanged"
            elif dry_run:
                entry["status"] = "would-move"
            else:
                try:
                    self._patch_collections(key, new, version)
                    entry["status"] = "moved"
                except ApiError as e:
                    if e.status == 412:  # lost a race: refetch once and retry
                        item = self.get_item(key)
                        new2 = [
                            c
                            for c in item["data"].get("collections", [])
                            if c != source_key
                        ]
                        if target_key not in new2:
                            new2.append(target_key)
                        try:
                            self._patch_collections(key, new2, item["version"])
                            entry["collections"] = new2
                            entry["status"] = "moved(retry)"
                        except ApiError as e2:
                            entry["status"] = "error"
                            entry["error"] = str(e2)
                    else:
                        entry["status"] = "error"
                        entry["error"] = str(e)
            results.append(entry)
        return results

    def move_collection(
        self, from_ref, to_ref, except_keys=None, dry_run=False,
        create_target=False, parent_ref=None,
    ):
        source = self.resolve_collection(from_ref)
        try:
            target = self.resolve_collection(to_ref)
        except ApiError:
            if not create_target:
                raise
            parent_key = self.resolve_collection(parent_ref)["key"] if parent_ref else None
            if dry_run:
                target = {"key": "(new)", "data": {"name": to_ref}}
            else:
                target = {
                    "key": self.create_collection(to_ref, parent_key),
                    "data": {"name": to_ref},
                }

        except_keys = set(except_keys or [])
        items = self.collection_items(source["key"])
        keys = [it["key"] for it in items if it["key"] not in except_keys]
        skipped = [it["key"] for it in items if it["key"] in except_keys]

        results = self._move_keys(keys, target["key"], source["key"], dry_run)
        return source, target, results, skipped


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _print(obj):
    print(json.dumps(obj, ensure_ascii=False, indent=2))


def _fail(msg, code=1):
    _print({"status": "error", "error": msg})
    sys.exit(code)


def build_parser():
    parser = argparse.ArgumentParser(
        description="Zotero local library write operations (via Local HTTP API)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--base", default=DEFAULT_BASE,
                        help=f"Local API base URL (default: {DEFAULT_BASE})")
    parser.add_argument("--api-key", default=None,
                        help="API key (default: $ZOTERO_LOCAL_API_KEY or cached key)")
    sub = parser.add_subparsers(dest="mode", required=True)

    sub.add_parser("ping", help="Check the local API and show server id/version")

    p = sub.add_parser("authorize", help="Obtain and cache a local API key")
    p.add_argument("--app-name", default=DEFAULT_APP_NAME)
    p.add_argument("--force", action="store_true", help="Ignore an existing cached key")

    sub.add_parser("collections", help="List collections (key, name, parent, count)")

    p = sub.add_parser("create-collection", help="Create a collection")
    p.add_argument("name")
    p.add_argument("--parent", default=None, help="Parent collection name or key")

    p = sub.add_parser("move", help="Add items to a collection (optionally remove from --from)")
    p.add_argument("keys", nargs="+", help="Item key(s)")
    p.add_argument("--to", required=True, help="Target collection name or key")
    p.add_argument("--from", dest="from_ref", default=None,
                   help="Source collection to also remove the items from")
    p.add_argument("--dry-run", action="store_true")

    p = sub.add_parser("move-collection", help="Move all items from one collection to another")
    p.add_argument("--from", dest="from_ref", required=True, help="Source collection name or key")
    p.add_argument("--to", dest="to_ref", required=True, help="Target collection name or key")
    p.add_argument("--except", dest="except_keys", nargs="*", default=[],
                   help="Item key(s) to leave in the source")
    p.add_argument("--create-target", action="store_true",
                   help="Create the target collection if it does not exist")
    p.add_argument("--parent", default=None,
                   help="Parent for a newly created target collection")
    p.add_argument("--dry-run", action="store_true")

    return parser


def _client(args):
    key = args.api_key or load_key()
    return LocalAPI(args.base, key)


def main():
    args = build_parser().parse_args()
    api = _client(args)

    try:
        if args.mode == "ping":
            cols = api.list_collections()
            _print({
                "status": "ok",
                "serverId": api._server_id,
                "libraryVersion": api.library_version(),
                "collections": len(cols),
                "hasApiKey": bool(api.api_key),
            })

        elif args.mode == "authorize":
            if api.api_key and not args.force:
                _print({"status": "ok", "cached": True, "key": api.api_key})
                return
            data = api.authorize(args.app_name)
            key = data.get("key")
            if not key:
                _fail(f"authorize returned no key: {data}")
            save_key(key)
            _print({"status": "ok", "cached": False, "key": key,
                    "remember": data.get("remember"), "keyFile": str(KEY_FILE)})

        elif args.mode == "collections":
            out = [
                {
                    "key": c["key"],
                    "name": c["data"]["name"],
                    "parent": c["data"].get("parentCollection") or None,
                    "numItems": c["meta"].get("numItems"),
                }
                for c in api.list_collections()
            ]
            _print({"status": "ok", "count": len(out), "items": out})

        elif args.mode == "create-collection":
            parent_key = None
            if args.parent:
                parent_key = api.resolve_collection(args.parent)["key"]
            key = api.create_collection(args.name, parent_key)
            _print({"status": "ok", "created": {"name": args.name, "key": key,
                                                "parent": parent_key}})

        elif args.mode == "move":
            target, source, results = api.move_items(
                args.keys, args.to, args.from_ref, args.dry_run
            )
            n = sum(1 for r in results if r["status"].startswith(("moved", "would")))
            _print({
                "status": "ok" if all(r["status"] != "error" for r in results) else "partial",
                "dryRun": args.dry_run,
                "target": {"name": target["data"]["name"], "key": target["key"]},
                "source": source and {"name": source["data"]["name"], "key": source["key"]},
                "moved": n,
                "results": results,
            })

        elif args.mode == "move-collection":
            source, target, results, skipped = api.move_collection(
                args.from_ref, args.to_ref, args.except_keys, args.dry_run,
                args.create_target, args.parent,
            )
            n = sum(1 for r in results if r["status"].startswith(("moved", "would")))
            errs = [r for r in results if r["status"] == "error"]
            _print({
                "status": "partial" if errs else "ok",
                "dryRun": args.dry_run,
                "source": {"name": source["data"]["name"], "key": source["key"]},
                "target": {"name": target["data"]["name"], "key": target["key"]},
                "candidates": len(results),
                "moved": n,
                "excepted": skipped,
                "errors": errs,
                "results": results,
            })

    except ApiError as e:
        if e.status == 401:
            _fail(f"write unauthorized (HTTP 401). Run: {sys.argv[0]} authorize\n{e.body}")
        _fail(str(e))
    except KeyboardInterrupt:
        _fail("interrupted", 130)


if __name__ == "__main__":
    main()
