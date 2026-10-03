# Running on Unraid

Every push to `main` builds a new Docker image and publishes it as:

```
ghcr.io/stefanhoagland/intercom-panel-request-site:latest
```

Unraid pulls that image, so nobody needs access to the server to ship an update. Everything the app saves (positions, key choices, notifications, photos) lives in `/mnt/user/appdata/intercom-panels`, which survives updates and is covered by appdata backups.

## 1. Let Unraid download the image (one time)

The repo is private, so the image is private too. Pick one:

- **Make just the image public (easiest).** On GitHub, open your profile → **Packages** → `intercom-panel-request-site` → **Package settings** → **Change visibility** → Public. The code stays private; only the built app is downloadable. No passwords are in the image.
- **Keep it private.** On GitHub, create a classic personal access token with only the `read:packages` scope (Settings → Developer settings → Personal access tokens). Then in the Unraid **Terminal** (top-right `>_` icon) run:
  ```
  docker login ghcr.io -u stefanhoagland
  ```
  and paste the token as the password. Unraid remembers it.

## 2. Add the container

In the **Docker** tab, click **Add Container** and fill in:

| Field | Value |
|---|---|
| Name | `intercom-panels` |
| Repository | `ghcr.io/stefanhoagland/intercom-panel-request-site:latest` |
| Network Type | `Bridge` |
| WebUI | `http://[IP]:[PORT:3000]/admin` |

Then use **Add another Path, Port, Variable…** for each of these:

| Type | Name | Container | Host / Value |
|---|---|---|---|
| Port | Web port | `3000` | `3000` (or any free port) |
| Path | Data | `/data` | `/mnt/user/appdata/intercom-panels` |
| Variable | Operator password | `USER_PASSWORD` | the shared password for everyone |
| Variable | Admin password | `ADMIN_PASSWORD` | your own password |
| Variable | Time zone | `TZ` | e.g. `America/Chicago` |

Click **Apply**. Operators use `http://<unraid-ip>:3000` and you use `http://<unraid-ip>:3000/admin`.

## 3. Automatic updates

Install **Auto Update Applications** from the **Apps** tab, then under **Settings → Auto Update Applications → Docker** turn updates on for `intercom-panels` (daily is plenty). Each new version pushed to GitHub is then picked up on its own. To update right away, click **Check for Updates** in the Docker tab and then **apply update**. Your data is kept either way.

## Building it yourself instead

If you ever want to skip GitHub, copy this folder to the server and run `docker build -t intercom-panels:latest .` in it, then use `intercom-panels:latest` as the Repository above. `docker-compose.yml` works the same way with the Docker Compose Manager plugin.
