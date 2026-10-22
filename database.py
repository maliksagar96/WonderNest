"""SQLite storage and schema management for WonderNest.

Run ``python database.py`` once to create database.db before starting app.py.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / "database.db"
DEFAULT_CATEGORIES = ["Inventory / resale goods", "Raw materials", "Packaging", "Equipment", "Office expense", "Other"]
COLLECTION_TABLES = {"vendors": "vendors", "purchases": "purchases", "categories": "categories", "recipes": "recipes", "recipe_settings": "recipe_settings", "prepared_items": "prepared_items", "projects": "projects"}


def connect() -> sqlite3.Connection:
    db = sqlite3.connect(DB_PATH, timeout=15)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    db.execute("PRAGMA busy_timeout = 15000")
    db.execute("PRAGMA synchronous = FULL")
    return db


@contextmanager
def database():
    db = connect()
    try:
        with db:
            yield db
    finally:
        db.close()


def initialize_database() -> bool:
    """Create schema and initial defaults. Returns True if the file was new."""
    was_new = not DB_PATH.exists()
    with database() as db:
        db.execute("PRAGMA journal_mode = WAL")
        for table in ("vendors", "purchases", "recipes", "recipe_settings", "prepared_items", "projects", "stock_items", "stock_movements"):
            db.execute(f"CREATE TABLE IF NOT EXISTS {table} (id TEXT PRIMARY KEY, data TEXT NOT NULL)")
        db.execute("CREATE TABLE IF NOT EXISTS categories (name TEXT PRIMARY KEY)")
        db.execute("CREATE TABLE IF NOT EXISTS stock_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        db.execute("CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        fresh_schema = db.execute("INSERT OR IGNORE INTO app_meta(key,value) VALUES('schema_version','1')").rowcount == 1
        db.execute("INSERT OR IGNORE INTO app_meta(key,value) VALUES('created_at',?)", (datetime.now(timezone.utc).isoformat(),))
        if fresh_schema and not db.execute("SELECT 1 FROM categories LIMIT 1").fetchone():
            db.executemany("INSERT INTO categories(name) VALUES(?)", ((name,) for name in DEFAULT_CATEGORIES))
    return was_new


def json_data(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def get_collection(name: str) -> list:
    with database() as db:
        if name == "categories":
            return [row[0] for row in db.execute("SELECT name FROM categories ORDER BY name COLLATE NOCASE")]
        table = COLLECTION_TABLES[name]
        order = " ORDER BY rowid DESC" if name == "prepared_items" else ""
        return [json.loads(row[0]) for row in db.execute(f"SELECT data FROM {table}{order}")]


def replace_collection(name: str, value: object) -> None:
    if not isinstance(value, list):
        raise ValueError(f"{name} must be a list")
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        if name == "categories":
            db.execute("DELETE FROM categories")
            cleaned = dict.fromkeys(str(item).strip() for item in value if str(item).strip())
            db.executemany("INSERT INTO categories(name) VALUES(?)", ((item,) for item in cleaned))
        else:
            table = COLLECTION_TABLES[name]
            records = []
            for item in value:
                if not isinstance(item, dict) or not item.get("id"):
                    raise ValueError(f"Every {name} record must have an id")
                records.append((str(item["id"]), json_data(item)))
            db.execute(f"DELETE FROM {table}")
            db.executemany(f"INSERT INTO {table}(id,data) VALUES(?,?)", records)


def get_stock() -> dict:
    with database() as db:
        items = [json.loads(row[0]) for row in db.execute("SELECT data FROM stock_items")]
        movements = [json.loads(row[0]) for row in db.execute("SELECT data FROM stock_movements ORDER BY rowid ASC")]
        meta = {row[0]: json.loads(row[1]) for row in db.execute("SELECT key,value FROM stock_meta")}
        return {"items": items, "movements": movements, "importedPurchaseIds": meta.get("importedPurchaseIds", []), "purchaseSnapshots": meta.get("purchaseSnapshots", {})}


def replace_stock(value: object) -> None:
    if not isinstance(value, dict):
        raise ValueError("stock must be an object")
    items, movements = value.get("items", []), value.get("movements", [])
    if not isinstance(items, list) or not isinstance(movements, list):
        raise ValueError("stock items and movements must be lists")
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        for table, records in (("stock_items", items), ("stock_movements", movements)):
            normalized = []
            for item in records:
                if not isinstance(item, dict) or not item.get("id"):
                    raise ValueError(f"Every {table} record must have an id")
                normalized.append((str(item["id"]), json_data(item)))
            db.execute(f"DELETE FROM {table}")
            db.executemany(f"INSERT INTO {table}(id,data) VALUES(?,?)", normalized)
        for key in ("importedPurchaseIds", "purchaseSnapshots"):
            default = [] if key.endswith("Ids") else {}
            db.execute("INSERT INTO stock_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, json_data(value.get(key, default))))


def prepare_recipe(recipe_id: str, output_quantity: object, color: object = "") -> dict:
    """Atomically record a prepared batch and deduct its recipe materials from stock."""
    try:
        quantity = int(output_quantity)
    except (TypeError, ValueError, OverflowError):
        raise ValueError("Enter a whole number of products to prepare.") from None
    if quantity < 1 or quantity > 1000000:
        raise ValueError("The number of products must be between 1 and 1,000,000.")
    color_name = str(color or "").strip()
    if not color_name or len(color_name) > 80:
        raise ValueError("Enter a color with no more than 80 characters.")

    def number(value: object) -> float:
        try:
            parsed = float(value)
            return parsed if parsed == parsed and abs(parsed) != float("inf") else 0.0
        except (TypeError, ValueError, OverflowError):
            return 0.0

    def unit_info(unit: object) -> tuple[str, float]:
        value = "".join(str(unit or "").strip().lower().split())
        groups = {
            "mass": {"mg": .001, "g": 1, "gram": 1, "grams": 1, "kg": 1000, "kilogram": 1000, "kilograms": 1000},
            "volume": {"ml": 1, "milliliter": 1, "milliliters": 1, "l": 1000, "lt": 1000, "liter": 1000, "liters": 1000},
            "count": {"pc": 1, "pcs": 1, "piece": 1, "pieces": 1, "unit": 1, "units": 1, "each": 1, "item": 1, "items": 1},
        }
        for dimension, units in groups.items():
            if value in units:
                return dimension, units[value]
        return f"custom:{value}", 1.0

    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT data FROM recipes WHERE id=?", (str(recipe_id),)).fetchone()
        if not row:
            raise ValueError("This recipe is no longer available. Refresh the calculator and try again.")
        recipe = json.loads(row[0])
        item_rows = db.execute("SELECT id,data FROM stock_items").fetchall()
        items = {item_id: json.loads(data) for item_id, data in item_rows}
        settings_row = db.execute("SELECT data FROM recipe_settings WHERE id='settings'").fetchone()
        recipe_settings = json.loads(settings_row[0]) if settings_row else {}
        reusable_ids = {str(entry.get("itemId")) for entry in recipe_settings.get("depreciatedItems", []) if entry.get("itemId")}
        required: dict[str, float] = {}
        reusable_required: dict[str, float] = {}
        item_lines: dict[str, dict] = {}
        materials = (recipe.get("ingredients") or []) + (recipe.get("packaging") or [])
        if not materials:
            raise ValueError("This recipe has no ingredients or packaging to deduct from stock.")
        for line in materials:
            item_id = str(line.get("itemId") or "")
            item = items.get(item_id)
            if not item:
                raise ValueError(f"{line.get('itemName') or 'A recipe item'} is no longer in Stock at Hand. Update the recipe first.")
            stock_unit = str(item.get("unit") or line.get("stockUnit") or line.get("unit") or "pcs")
            recipe_unit = str(line.get("unit") or stock_unit)
            recipe_dimension, recipe_factor = unit_info(recipe_unit)
            stock_dimension, stock_factor = unit_info(stock_unit)
            if recipe_dimension != stock_dimension:
                raise ValueError(f"The unit for {item.get('name') or 'a recipe item'} does not match its stock unit. Update the recipe first.")
            per_product = number(line.get("quantity")) * recipe_factor / stock_factor
            used = per_product * quantity
            if item_id in reusable_ids:
                reusable_required[item_id] = reusable_required.get(item_id, 0.0) + per_product
            else:
                required[item_id] = required.get(item_id, 0.0) + used
            item_lines[item_id] = {"itemId": item_id, "itemName": item.get("name") or line.get("itemName") or "Item", "unit": stock_unit}

        for item_id, used in required.items():
            item = items[item_id]
            available = number(item.get("quantity"))
            if used > available + 1e-9:
                details = item_lines[item_id]
                raise ValueError(f"Not enough {details['itemName']} in stock. Need {used:g} {details['unit']}; only {available:g} {details['unit']} available.")

        for item_id, needed_at_once in reusable_required.items():
            item = items[item_id]
            available = number(item.get("quantity"))
            if needed_at_once > available + 1e-9:
                details = item_lines[item_id]
                raise ValueError(f"Not enough reusable {details['itemName']} available. This recipe needs {needed_at_once:g} {details['unit']} at a time; only {available:g} {details['unit']} available.")

        now = datetime.now(timezone.utc).isoformat()
        movements = [json.loads(row[0]) for row in db.execute("SELECT data FROM stock_movements ORDER BY rowid ASC")]
        batch_id = uuid4().hex
        used_materials = []
        new_movements = []
        for item_id, used in required.items():
            item = items[item_id]
            balance = max(0.0, number(item.get("quantity")) - used)
            item["quantity"] = balance
            item["updatedAt"] = now
            details = item_lines[item_id]
            used_materials.append({**details, "quantity": used})
            new_movements.append({"id": uuid4().hex, "itemId": item_id, "preparedItemId": batch_id, "itemName": details["itemName"], "type": "out", "change": used, "balance": balance, "unit": details["unit"], "reason": f"Prepared {quantity} × {recipe.get('name') or 'recipe'}", "source": "Prepared item", "date": now})

        for item_id, used_per_product in reusable_required.items():
            details = item_lines[item_id]
            used_materials.append({**details, "quantity": used_per_product * quantity, "unit": "uses", "reusable": True, "availableQuantity": number(items[item_id].get("quantity")), "stockUnit": details["unit"]})

        prepared = {"id": batch_id, "recipeId": recipe["id"], "name": recipe.get("name") or "Prepared item", "color": color_name, "quantity": quantity, "createdAt": now, "materials": used_materials}
        db.execute("INSERT INTO prepared_items(id,data) VALUES(?,?)", (batch_id, json_data(prepared)))
        db.executemany("UPDATE stock_items SET data=? WHERE id=?", ((json_data(item), item_id) for item_id, item in items.items() if item_id in required))
        db.execute("DELETE FROM stock_movements")
        db.executemany("INSERT INTO stock_movements(id,data) VALUES(?,?)", ((move["id"], json_data(move)) for move in [*new_movements, *movements]))
        return {"preparedItem": prepared}


def update_prepared_recipe(prepared_id: str, recipe_id: str, output_quantity: object, color: object) -> dict:
    """Edit a shelf batch and atomically reconcile its consumed recipe materials."""
    try:
        quantity = int(output_quantity)
    except (TypeError, ValueError, OverflowError):
        raise ValueError("Enter a whole number of products.") from None
    if quantity < 1 or quantity > 1000000:
        raise ValueError("The number of products must be between 1 and 1,000,000.")
    color_name = str(color or "").strip()
    if not color_name or len(color_name) > 80:
        raise ValueError("Enter a color with no more than 80 characters.")

    def number(value: object) -> float:
        try:
            parsed = float(value)
            return parsed if parsed == parsed and abs(parsed) != float("inf") else 0.0
        except (TypeError, ValueError, OverflowError):
            return 0.0

    def unit_info(unit: object) -> tuple[str, float]:
        value = "".join(str(unit or "").strip().lower().split())
        groups = {
            "mass": {"mg": .001, "g": 1, "gram": 1, "grams": 1, "kg": 1000, "kilogram": 1000, "kilograms": 1000},
            "volume": {"ml": 1, "milliliter": 1, "milliliters": 1, "l": 1000, "lt": 1000, "liter": 1000, "liters": 1000},
            "count": {"pc": 1, "pcs": 1, "piece": 1, "pieces": 1, "unit": 1, "units": 1, "each": 1, "item": 1, "items": 1},
        }
        for dimension, units in groups.items():
            if value in units:
                return dimension, units[value]
        return f"custom:{value}", 1.0

    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        prepared_row = db.execute("SELECT data FROM prepared_items WHERE id=?", (str(prepared_id),)).fetchone()
        if not prepared_row:
            raise ValueError("This item is no longer on The Wonder Shelf.")
        prepared = json.loads(prepared_row[0])
        if prepared.get("restoredAt"):
            raise ValueError("This item has already been returned to Stock at Hand.")
        recipe_row = db.execute("SELECT data FROM recipes WHERE id=?", (str(recipe_id),)).fetchone()
        if not recipe_row:
            raise ValueError("Choose a recipe that is still available.")
        recipe = json.loads(recipe_row[0])
        item_rows = db.execute("SELECT id,data FROM stock_items").fetchall()
        items = {item_id: json.loads(data) for item_id, data in item_rows}
        settings_row = db.execute("SELECT data FROM recipe_settings WHERE id='settings'").fetchone()
        settings = json.loads(settings_row[0]) if settings_row else {}
        reusable_ids = {str(entry.get("itemId")) for entry in settings.get("depreciatedItems", []) if entry.get("itemId")}
        old_consumed: dict[str, float] = {}
        for material in prepared.get("materials", []):
            if material.get("reusable"):
                continue
            item_id = str(material.get("itemId") or "")
            if item_id and number(material.get("quantity")) > 0:
                old_consumed[item_id] = old_consumed.get(item_id, 0.0) + number(material.get("quantity"))

        needed: dict[str, float] = {}
        reusable_needed: dict[str, float] = {}
        item_lines: dict[str, dict] = {}
        materials = (recipe.get("ingredients") or []) + (recipe.get("packaging") or [])
        if not materials:
            raise ValueError("This recipe has no ingredients or packaging to deduct from stock.")
        for line in materials:
            item_id = str(line.get("itemId") or "")
            item = items.get(item_id)
            if not item:
                raise ValueError(f"{line.get('itemName') or 'A recipe item'} is no longer in Stock at Hand. Update the recipe first.")
            stock_unit = str(item.get("unit") or line.get("stockUnit") or line.get("unit") or "pcs")
            recipe_unit = str(line.get("unit") or stock_unit)
            recipe_dimension, recipe_factor = unit_info(recipe_unit)
            stock_dimension, stock_factor = unit_info(stock_unit)
            if recipe_dimension != stock_dimension:
                raise ValueError(f"The unit for {item.get('name') or 'a recipe item'} does not match its stock unit. Update the recipe first.")
            per_product = number(line.get("quantity")) * recipe_factor / stock_factor
            total = per_product * quantity
            if item_id in reusable_ids:
                reusable_needed[item_id] = reusable_needed.get(item_id, 0.0) + total
            else:
                needed[item_id] = needed.get(item_id, 0.0) + total
            item_lines[item_id] = {"itemId": item_id, "itemName": item.get("name") or line.get("itemName") or "Item", "unit": stock_unit}

        deltas = {item_id: needed.get(item_id, 0.0) - old_consumed.get(item_id, 0.0) for item_id in set(needed) | set(old_consumed)}
        for item_id, delta in deltas.items():
            if item_id not in items:
                name = next((m.get("itemName") for m in prepared.get("materials", []) if str(m.get("itemId")) == item_id), "A recipe item")
                raise ValueError(f"Cannot reconcile {name}: it no longer exists in Stock at Hand.")
            available = number(items[item_id].get("quantity"))
            if delta > available + 1e-9:
                details = item_lines.get(item_id) or {"itemName": items[item_id].get("name") or "Item", "unit": items[item_id].get("unit") or "pcs"}
                raise ValueError(f"Not enough {details['itemName']} in stock. This edit needs {delta:g} {details['unit']} more; only {available:g} {details['unit']} available.")

        for item_id, total in reusable_needed.items():
            item = items[item_id]
            details = item_lines[item_id]
            required_at_once = total / quantity
            if required_at_once > number(item.get("quantity")) + 1e-9:
                raise ValueError(f"Not enough reusable {details['itemName']} available. This recipe needs {required_at_once:g} {details['unit']} at a time; only {number(item.get('quantity')):g} {details['unit']} available.")

        now = datetime.now(timezone.utc).isoformat()
        movements = [json.loads(row[0]) for row in db.execute("SELECT data FROM stock_movements ORDER BY rowid ASC")]
        adjustment_movements = []
        changed_ids = set()
        for item_id, delta in deltas.items():
            if abs(delta) <= 1e-12:
                continue
            item = items[item_id]
            balance = max(0.0, number(item.get("quantity")) - delta)
            item["quantity"] = balance
            item["maxStock"] = max(number(item.get("maxStock")), balance)
            item["updatedAt"] = now
            details = item_lines.get(item_id) or {"itemName": item.get("name") or "Item", "unit": item.get("unit") or "pcs"}
            adjustment_movements.append({"id": uuid4().hex, "itemId": item_id, "preparedItemId": str(prepared_id), "itemName": details["itemName"], "type": "out" if delta > 0 else "in", "change": abs(delta), "balance": balance, "unit": details["unit"], "reason": f"Edited prepared {quantity} × {recipe.get('name') or 'recipe'}", "source": "Prepared item edit", "date": now})
            changed_ids.add(item_id)

        new_materials = [{**item_lines[item_id], "quantity": total} for item_id, total in needed.items()]
        new_materials.extend({**item_lines[item_id], "quantity": total, "unit": "uses", "reusable": True, "availableQuantity": number(items[item_id].get("quantity")), "stockUnit": item_lines[item_id]["unit"]} for item_id, total in reusable_needed.items())
        prepared.update({"recipeId": recipe["id"], "name": recipe.get("name") or "Prepared item", "color": color_name, "quantity": quantity, "materials": new_materials, "editedAt": now})
        db.execute("UPDATE prepared_items SET data=? WHERE id=?", (json_data(prepared), str(prepared_id)))
        if changed_ids:
            db.executemany("UPDATE stock_items SET data=? WHERE id=?", ((json_data(items[item_id]), item_id) for item_id in changed_ids))
        if adjustment_movements:
            db.execute("DELETE FROM stock_movements")
            db.executemany("INSERT INTO stock_movements(id,data) VALUES(?,?)", ((move["id"], json_data(move)) for move in [*adjustment_movements, *movements]))
        return {"preparedItem": prepared}


def restore_prepared_item(prepared_id: str) -> dict:
    """Undo a prepared batch by returning its consumed materials to stock once."""
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT data FROM prepared_items WHERE id=?", (str(prepared_id),)).fetchone()
        if not row:
            raise ValueError("This prepared batch is no longer on The Wonder Shelf.")
        prepared = json.loads(row[0])
        if prepared.get("restoredAt"):
            raise ValueError("This batch has already been returned to Stock at Hand.")

        item_rows = db.execute("SELECT id,data FROM stock_items").fetchall()
        items = {item_id: json.loads(data) for item_id, data in item_rows}
        now = datetime.now(timezone.utc).isoformat()
        returned = []
        new_movements = []
        for material in prepared.get("materials", []):
            if material.get("reusable"):
                continue
            item_id = str(material.get("itemId") or "")
            item = items.get(item_id)
            if item is None:
                wanted_name = str(material.get("itemName") or "").strip().casefold()
                wanted_unit = str(material.get("unit") or "").strip().casefold()
                item = next((entry for entry in items.values() if str(entry.get("name") or "").strip().casefold() == wanted_name and str(entry.get("unit") or "").strip().casefold() == wanted_unit), None)
                item_id = str(item.get("id")) if item else ""
            if item is None:
                name = material.get("itemName") or "A recipe item"
                raise ValueError(f"Cannot return {name}: it no longer exists in Stock at Hand. Restore or recreate that stock item first.")
            amount = float(material.get("quantity") or 0)
            if amount <= 0 or not amount < float("inf"):
                continue
            balance = float(item.get("quantity") or 0) + amount
            item["quantity"] = balance
            item["maxStock"] = max(float(item.get("maxStock") or 0), balance)
            item["updatedAt"] = now
            returned.append({"itemId": item_id, "itemName": item.get("name") or material.get("itemName") or "Item", "quantity": amount, "unit": item.get("unit") or material.get("unit") or "pcs"})
            new_movements.append({"id": uuid4().hex, "preparedItemId": str(prepared_id), "itemId": item_id, "itemName": item.get("name") or material.get("itemName") or "Item", "type": "in", "change": amount, "balance": balance, "unit": item.get("unit") or material.get("unit") or "pcs", "reason": f"Returned materials from {prepared.get('name') or 'prepared item'}", "source": "Prepared item returned", "date": now})

        prepared["restoredAt"] = now
        prepared["returnedMaterials"] = returned
        db.execute("UPDATE prepared_items SET data=? WHERE id=?", (json_data(prepared), str(prepared_id)))
        db.executemany("UPDATE stock_items SET data=? WHERE id=?", ((json_data(item), item_id) for item_id, item in items.items() if any(material["itemId"] == item_id for material in returned)))
        movements = [json.loads(move[0]) for move in db.execute("SELECT data FROM stock_movements ORDER BY rowid ASC")]
        if new_movements:
            db.execute("DELETE FROM stock_movements")
            db.executemany("INSERT INTO stock_movements(id,data) VALUES(?,?)", ((move["id"], json_data(move)) for move in [*new_movements, *movements]))
        return {"preparedItem": prepared, "returnedMaterials": returned}


def database_empty() -> bool:
    with database() as db:
        for table in ("vendors", "purchases", "recipes", "prepared_items", "projects", "stock_items", "stock_movements"):
            if db.execute(f"SELECT 1 FROM {table} LIMIT 1").fetchone():
                return False
        return True


def import_legacy(payload: object) -> dict:
    if not isinstance(payload, dict):
        raise ValueError("The import file must contain a WonderNest data object")

    def from_key(key: str, alias: str, default: object) -> object:
        return payload.get(key, payload.get(alias, default))

    vendors = from_key("wonderNest.vendors.v1", "vendors", [])
    purchases = from_key("wonderNest.purchases.v1", "purchases", [])
    categories = from_key("wonderNest.purchaseCategories.v1", "categories", [])
    recipes = from_key("wonderNest.recipes.v1", "recipes", [])
    stock = from_key("wonderNest.stock.v1", "stock", {})
    if isinstance(stock, list):
        stock = {"items": stock, "movements": []}
    projects = from_key("wonderNest.projects.v1", "projects", [])
    for name, value in (("vendors", vendors), ("purchases", purchases), ("categories", categories), ("recipes", recipes), ("projects", projects)):
        if not isinstance(value, list):
            raise ValueError(f"Imported {name} data is not a list")
    if not isinstance(stock, dict) or not isinstance(stock.get("items", []), list) or not isinstance(stock.get("movements", []), list):
        raise ValueError("Imported stock data has an unexpected format")
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        for name, value in (("vendors", vendors), ("purchases", purchases), ("recipes", recipes), ("projects", projects)):
            rows = []
            for item in value:
                if not isinstance(item, dict) or not item.get("id"):
                    raise ValueError(f"Imported {name} record is missing its id")
                rows.append((str(item["id"]), json_data(item)))
            db.executemany(f"INSERT INTO {name}(id,data) VALUES(?,?)", rows)
        unique_categories = dict.fromkeys(str(item).strip() for item in categories if str(item).strip()) or dict.fromkeys(DEFAULT_CATEGORIES)
        db.execute("DELETE FROM categories")
        db.executemany("INSERT INTO categories(name) VALUES(?)", ((item,) for item in unique_categories))
        for table, records in (("stock_items", stock.get("items", [])), ("stock_movements", stock.get("movements", []))):
            rows = []
            for item in records:
                if not isinstance(item, dict) or not item.get("id"):
                    raise ValueError(f"Imported {table} record is missing its id")
                rows.append((str(item["id"]), json_data(item)))
            db.executemany(f"INSERT INTO {table}(id,data) VALUES(?,?)", rows)
        for key in ("importedPurchaseIds", "purchaseSnapshots"):
            default = [] if key.endswith("Ids") else {}
            db.execute("INSERT INTO stock_meta(key,value) VALUES(?,?)", (key, json_data(stock.get(key, default))))
    return {"vendors": len(vendors), "purchases": len(purchases), "categories": len(unique_categories), "recipes": len(recipes), "projects": len(projects), "stockItems": len(stock.get("items", [])), "stockMovements": len(stock.get("movements", []))}


def inspect_database() -> dict:
    with database() as db:
        integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
        version = db.execute("SELECT value FROM app_meta WHERE key='schema_version'").fetchone()
        counts = {table: db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] for table in ("vendors", "purchases", "categories", "recipes", "prepared_items", "projects", "stock_items", "stock_movements")}
    return {"path": str(DB_PATH), "integrity": integrity, "schemaVersion": version[0] if version else "missing", "counts": counts}


def main() -> None:
    parser = argparse.ArgumentParser(description="Create the WonderNest SQLite database (safe to run again).")
    parser.add_argument("--check", action="store_true", help="check the database integrity instead of creating the schema")
    args = parser.parse_args()
    if args.check:
        if not DB_PATH.exists():
            raise SystemExit(f"Database does not exist: {DB_PATH}")
        result = inspect_database()
        print(json.dumps(result, indent=2))
        raise SystemExit(0 if result["integrity"] == "ok" else 1)
    was_new = initialize_database()
    print(f"{'Created' if was_new else 'Initialized'} WonderNest database: {DB_PATH}")
    print("Existing records were preserved.")


if __name__ == "__main__":
    main()
