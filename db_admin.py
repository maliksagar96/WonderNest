"""Explicit maintenance commands for the WonderNest SQLite database."""
from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path

from database import DB_PATH, initialize_database, inspect_database


def reset_database() -> None:
    if not DB_PATH.exists():
        initialize_database()
        print(f"Created an empty database at {DB_PATH}")
        return
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    archived = []
    for suffix in ("", "-wal", "-shm"):
        source = Path(f"{DB_PATH}{suffix}")
        if source.exists():
            destination = source.with_name(f"{source.name}.reset-{stamp}")
            source.rename(destination)
            archived.append(str(destination))
    initialize_database()
    print("A new empty WonderNest database was created.")
    print("Previous database files were preserved as:")
    for path in archived:
        print(f"  {path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Check or explicitly reset WonderNest's local SQLite database.")
    actions = parser.add_subparsers(dest="action", required=True)
    actions.add_parser("check", help="run SQLite integrity check and show record counts")
    reset = actions.add_parser("reset", help="delete all app records and restore default categories")
    reset.add_argument("--confirm", action="store_true", help="confirm the destructive reset")
    args = parser.parse_args()
    if args.action == "check":
        if not DB_PATH.exists():
            raise SystemExit(f"Database does not exist: {DB_PATH}; create it with python database.py")
        import json
        result = inspect_database()
        print(json.dumps(result, indent=2))
        raise SystemExit(0 if result["integrity"] == "ok" else 1)
    if not args.confirm:
        raise SystemExit("Reset cancelled. To delete every WonderNest record, rerun with: python db_admin.py reset --confirm")
    reset_database()


if __name__ == "__main__":
    main()
