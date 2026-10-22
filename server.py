"""Local HTTP server for the WonderNest interface and SQLite API."""
from __future__ import annotations

import json
import sqlite3
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

from database import (
    COLLECTION_TABLES,
    DB_PATH,
    database,
    database_empty,
    get_collection,
    get_stock,
    import_legacy,
    prepare_recipe,
    replace_collection,
    replace_stock,
    restore_prepared_item,
    update_prepared_recipe,
)
ROOT = Path(__file__).resolve().parent
HOST = "127.0.0.1"
PORT = 8000
MAX_BODY = 20 * 1024 * 1024


class WonderNestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_json(self, value: object, status: int = 200) -> None:
        data = json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def read_json(self) -> object:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > MAX_BODY:
            raise ValueError("Request body is empty or too large")
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def local_request_allowed(self) -> bool:
        if self.headers.get("Host", "").lower() not in (f"{HOST}:{PORT}", f"localhost:{PORT}"):
            return False
        origin = self.headers.get("Origin")
        return not origin or origin in (f"http://{HOST}:{PORT}", f"http://localhost:{PORT}")

    def do_GET(self) -> None:
        path = unquote(urlsplit(self.path).path)
        if path.lower().endswith((".db", ".db-wal", ".db-shm", ".py", ".sqlite", ".sqlite3")) or path.lower().endswith("-journal"):
            return self.send_error(404)
        try:
            if path == "/api/stock":
                return self.send_json(get_stock())
            if path == "/api/issues":
                return self.send_json(run_issue_scan())
            if path == "/api/status":
                with database() as db:
                    counts = {name: db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] for name, table in COLLECTION_TABLES.items() if name != "categories"}
                    counts["categories"] = db.execute("SELECT COUNT(*) FROM categories").fetchone()[0]
                    counts["stockItems"] = db.execute("SELECT COUNT(*) FROM stock_items").fetchone()[0]
                    version = db.execute("SELECT value FROM app_meta WHERE key='schema_version'").fetchone()[0]
                return self.send_json({"database": DB_PATH.name, "schemaVersion": version, "empty": database_empty(), "counts": counts})
            if path.startswith("/api/"):
                name = path.removeprefix("/api/")
                if name in COLLECTION_TABLES:
                    return self.send_json(get_collection(name))
                return self.send_json({"error": "Unknown API endpoint"}, 404)
            return super().do_GET()
        except sqlite3.Error as exc:
            return self.send_json({"error": f"SQLite could not read the database: {exc}"}, 500)

    def do_PUT(self) -> None:
        if not self.local_request_allowed():
            return self.send_json({"error": "Requests must come from the local WonderNest app."}, 403)
        path = unquote(urlsplit(self.path).path)
        try:
            value = self.read_json()
            if path == "/api/stock":
                replace_stock(value)
                return self.send_json({"ok": True})
            if path.startswith("/api/"):
                name = path.removeprefix("/api/")
                if name in COLLECTION_TABLES:
                    replace_collection(name, value)
                    return self.send_json({"ok": True})
            return self.send_json({"error": "Unknown API endpoint"}, 404)
        except (ValueError, TypeError, json.JSONDecodeError) as exc:
            return self.send_json({"error": str(exc)}, 400)
        except sqlite3.IntegrityError as exc:
            return self.send_json({"error": f"Database rejected the update: {exc}"}, 409)
        except sqlite3.Error as exc:
            return self.send_json({"error": f"SQLite could not save the data: {exc}"}, 500)

    def do_POST(self) -> None:
        if not self.local_request_allowed():
            return self.send_json({"error": "Requests must come from the local WonderNest app."}, 403)
        path = unquote(urlsplit(self.path).path)
        if path == "/api/prepare-product":
            try:
                payload = self.read_json()
                if not isinstance(payload, dict):
                    raise ValueError("Invalid prepared product request.")
                return self.send_json(prepare_recipe(payload.get("recipeId", ""), payload.get("quantity", 0), payload.get("color", "")))
            except (ValueError, TypeError, json.JSONDecodeError) as exc:
                return self.send_json({"error": str(exc)}, 400)
            except sqlite3.Error as exc:
                return self.send_json({"error": f"SQLite could not save the prepared item: {exc}"}, 500)
        if path == "/api/restore-prepared-item":
            try:
                payload = self.read_json()
                if not isinstance(payload, dict) or not payload.get("preparedItemId"):
                    raise ValueError("Choose a prepared batch to restore.")
                return self.send_json(restore_prepared_item(payload["preparedItemId"]))
            except (ValueError, TypeError, json.JSONDecodeError) as exc:
                return self.send_json({"error": str(exc)}, 400)
            except sqlite3.Error as exc:
                return self.send_json({"error": f"SQLite could not restore the prepared item: {exc}"}, 500)
        if path == "/api/update-prepared-item":
            try:
                payload = self.read_json()
                if not isinstance(payload, dict) or not payload.get("preparedItemId"):
                    raise ValueError("Choose an item on The Wonder Shelf to edit.")
                return self.send_json(update_prepared_recipe(payload["preparedItemId"], payload.get("recipeId", ""), payload.get("quantity", 0), payload.get("color", "")))
            except (ValueError, TypeError, json.JSONDecodeError) as exc:
                return self.send_json({"error": str(exc)}, 400)
            except sqlite3.Error as exc:
                return self.send_json({"error": f"SQLite could not update the prepared item: {exc}"}, 500)
        if path != "/api/import-legacy":
            return self.send_json({"error": "Unknown API endpoint"}, 404)
        try:
            if not database_empty():
                return self.send_json({"error": "The database already contains data. Import is allowed only into an empty database."}, 409)
            result = import_legacy(self.read_json())
            return self.send_json({"ok": True, "imported": result})
        except (ValueError, TypeError, json.JSONDecodeError) as exc:
            return self.send_json({"error": str(exc)}, 400)
        except sqlite3.IntegrityError as exc:
            return self.send_json({"error": f"Import stopped because of conflicting records: {exc}"}, 409)
        except sqlite3.Error as exc:
            return self.send_json({"error": f"SQLite could not import the data: {exc}"}, 500)

    def log_message(self, fmt: str, *args) -> None:
        print(f"[{self.log_date_time_string()}] {self.address_string()} {fmt % args}")


def main() -> None:
    if not DB_PATH.exists():
        print(f"WonderNest database not found: {DB_PATH}", file=sys.stderr)
        print("Create it once by running: python database.py", file=sys.stderr)
        raise SystemExit(1)
    try:
        server = ThreadingHTTPServer((HOST, PORT), WonderNestHandler)
    except OSError as exc:
        print(f"Could not start WonderNest at http://{HOST}:{PORT}: {exc}", file=sys.stderr)
        print("Close the other process using port 8000 or change PORT in server.py.", file=sys.stderr)
        raise SystemExit(1)
    print("WonderNest is running locally.")
    print(f"App:      http://{HOST}:{PORT}/")
    print(f"Database: {DB_PATH}")
    print("Keep this terminal window open while using the app. Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping WonderNest...")
    finally:
        server.server_close()


def run_issue_scan() -> dict:
    """Check the local database for structural and saved-record problems."""
    if not DB_PATH.exists():
        return {"ok": False, "checkedAt": None, "issues": [{"severity": "error", "title": "Database file is missing", "detail": "Run python database.py to create the WonderNest database."}], "checks": 0}

    issues: list[dict[str, str]] = []
    checks = 0
    record_tables = ("vendors", "purchases", "recipes", "recipe_settings", "prepared_items", "projects", "stock_items", "stock_movements")
    with database() as db:
        checks += 1
        integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            issues.append({"severity": "error", "title": "Database integrity check failed", "detail": str(integrity)})

        checks += 1
        existing_tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        required_tables = {*record_tables, "categories", "stock_meta", "app_meta"}
        missing_tables = sorted(required_tables - existing_tables)
        if missing_tables:
            issues.append({"severity": "error", "title": "Database tables are missing", "detail": ", ".join(missing_tables)})

        if not missing_tables:
            for table in record_tables:
                for row_id, raw in db.execute(f"SELECT id, data FROM {table}"):
                    checks += 1
                    try:
                        record = json.loads(raw)
                        if not isinstance(record, dict) or str(record.get("id", "")) != str(row_id):
                            raise ValueError("record ID does not match its database key")
                    except (json.JSONDecodeError, ValueError, TypeError) as exc:
                        issues.append({"severity": "error", "title": f"Invalid saved data in {table}", "detail": f"Record {row_id}: {exc}"})

    if not issues:
        issues.append({"severity": "success", "title": "No database issues found", "detail": "The database integrity, required tables, and saved records look healthy."})
    from datetime import datetime, timezone
    return {"ok": not any(item["severity"] == "error" for item in issues), "checkedAt": datetime.now(timezone.utc).isoformat(), "issues": issues, "checks": checks}


if __name__ == "__main__":
    main()
