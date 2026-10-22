# WonderNest local app

WonderNest now runs as a local Python web app. It uses Python 3.10+ and the standard library, including SQLite; there are no packages to install.

## First-time setup

Open a terminal in the WonderNest folder and run `python database.py` once (on some Windows installations, use `py database.py`). This creates the schema and `database.db`. Running it again is safe and preserves existing records.

## Start the app

1. Run `python app.py` (or `py app.py`). `app.py` only launches the local server; it does not create or reset the database.
2. Open `http://127.0.0.1:8000/` in your browser.
3. Keep the terminal open while using the app. Press Ctrl+C there to stop it.

The SQLite file is `database.db` in this folder. Run the app from the same folder each time; it binds to this computer only at `127.0.0.1`.

## Move existing browser data once

The previous static version saved data in browser local storage. It cannot be read directly by Python because browser storage is isolated from files and from other web addresses.

1. Before closing or clearing the old browser profile/site data, open `legacy-export.html` using the same browser profile and the same address/origin you used for the old app. If the old app was opened from disk, open `legacy-export.html` from disk too. If it was served by a local static server, use that same server address and port to open `/legacy-export.html`.
2. Download `wonderNest-browser-data.json`.
3. Create the database with `python database.py` if you have not already done so. Start `app.py`, open the new app, choose **Import Data**, and select that JSON file.

Import is allowed only while the SQLite database has no user records. It writes the imported datasets in one transaction and does not alter the old browser data. If the export page reports no data, check that it was opened from the old app's original browser address/profile before proceeding.

## Data handling

Purchases, vendors, categories, stock items, stock movements, stock synchronization metadata, recipes, and ongoing projects are stored in SQLite tables. Writes use transactions. SQLite schema version is recorded in `app_meta`; future schema changes should add migrations and keep existing records.

## Database maintenance

- Check database integrity and see record counts: `python db_admin.py check`.
- Reset the app to a new empty database: stop the app, then run `python db_admin.py reset --confirm`. The old database and any SQLite sidecar files are renamed with a `.reset-<timestamp>` suffix in this folder before a fresh database is created.

Do not run the reset command unless you intend to start with an empty app database.
