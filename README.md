# Intercom Panel Requests

Operators log in with one shared password, pick their intercom position, and choose the label and talk/listen setting for every key on that position's **RTS KP-4016** (16 keys, 1RU, on top) and **RTS KP-5032** (32 keys, 2RU, below). Changes save automatically. When they click **Submit**, the admin page shows a notification that the panel is ready to program.

## Pages
- `/` operator page (shared password)
- `/admin` admin page (separate admin password): notifications, add/rename/delete positions, view and print each panel's key list, mark a panel programmed or reopen it, upload reference photos that operators see.

## Run it
Needs Node 18 or newer. No packages to install.

```
USER_PASSWORD=choose-one ADMIN_PASSWORD=choose-another node server.js
```

Then open http://localhost:3000. Optional settings: `PORT` (default 3000) and `DATA_DIR` (default `./data`). All data lives in `DATA_DIR` (`db.json` plus uploaded photos), so back up that folder.

If you don't set the passwords, they default to `intercom` and `admin`; change them before putting the site online.

## Docker / Unraid
Every push to `main` publishes `ghcr.io/stefanhoagland/intercom-panel-request-site:latest`. See [UNRAID.md](UNRAID.md) for setting it up on Unraid with automatic updates. `docker compose up -d` also works anywhere Docker runs.
