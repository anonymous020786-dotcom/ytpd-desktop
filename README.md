# Playlist Grabber — Desktop

A native Windows (and eventually macOS/Linux) desktop build of Playlist Grabber, wrapping the same ASP.NET Core backend and Next.js frontend from the (separate, private) [ytpd-web](https://github.com/anonymous020786-dotcom/ytpd-web) repo in an Electron shell instead of a browser tab.

This repo is deliberately just the native wrapper — window, packaging, sidecar orchestration. The actual download engine (YoutubeExplode/ffmpeg/TagLib# backend, the React UI) lives in `ytpd-web` and isn't duplicated here. To build this, clone `ytpd-web` as a **sibling directory** of this one:

```
some-folder/
  ytpd-web/     <- backend/ and frontend/ live here (private repo)
  ytpd-desktop/ <- this repo
```

`scripts/prepare-resources.mjs` reaches across to `../ytpd-web/backend` and `../ytpd-web/frontend` to publish/build them into this project's `resources/` folder before packaging. Cloned it somewhere else? Set `YTPD_WEB_REPO_PATH` to point at it instead.

## How it works

Electron's main process spawns two local "sidecar" processes bound to `127.0.0.1` on fixed ports, waits for both to come up, then opens a window pointed at the frontend:

- **Backend** (`127.0.0.1:47391`) — the same `YtpdWeb.Api` from `ytpd-web/backend`, published as a self-contained single-file `.exe` (no .NET runtime install required). Runs with `Auth:LocalMode=true`, which enables an unauthenticated `/api/auth/local-token` endpoint — safe only because this process never binds to anything but loopback. The frontend auto-detects it's running inside Electron (via a `contextBridge`-exposed `window.electronAPI`) and calls that endpoint on launch instead of showing a login screen.
- **Frontend** (`127.0.0.1:47392`) — the same Next.js app from `ytpd-web/frontend`, built with `output: "standalone"` and its `NEXT_PUBLIC_API_URL` baked in at build time to the fixed backend port above (which is why the port is fixed rather than dynamically chosen — a browser client env var can't be changed after the fact). Hosted by running Electron's own binary in plain-Node mode (`ELECTRON_RUN_AS_NODE=1`) against the standalone `server.js`, so no separate Node.js runtime needs bundling either.
- **ffmpeg** — bundled as a plain binary and pointed to via `Ffmpeg:Path`, since the desktop build can't rely on it being on the end user's `PATH`.

All persistent data (SQLite job history, temp download files, the chosen downloads folder, a per-install JWT secret) lives under Electron's `userData` directory, except the downloads folder itself, which defaults to `~/Downloads/Playlist Grabber` and can be changed from the navbar (native folder picker) — picking a new one restarts just the backend sidecar with the new path.

## Prerequisites

- Node 20+
- .NET 8 SDK (to publish the backend)
- A static `ffmpeg.exe` to bundle (not fetched automatically — see below)

## Building

```bash
npm install
```

**Dev mode** (runs `dist/*.js` directly against whatever's in `resources/`, which you must have already prepared at least once):

```bash
YTPD_FFMPEG_PATH=/path/to/ffmpeg.exe npm run prepare:resources   # publishes backend, builds frontend, bundles ffmpeg
npm start
```

**Production installer:**

```bash
YTPD_FFMPEG_PATH=/path/to/ffmpeg.exe npm run dist
```

This publishes the backend (self-contained `win-x64`), builds the frontend with the desktop API URL baked in, bundles ffmpeg, and runs `electron-builder` to produce an NSIS installer under `release/`.

### Known issue: NSIS installer step needs Developer Mode or an admin shell

electron-builder unconditionally tries to download and extract a macOS code-signing tools archive (`winCodeSign`) even for a Windows-only build — a [known electron-builder quirk](https://github.com/electron-userland/electron-builder/issues/8242) unrelated to this app. Extracting it creates symlinks, which standard (non-elevated) Windows accounts can't do without **Developer Mode** enabled (Settings → Privacy & Security → For Developers), or running the build from an **Administrator** terminal. Either one is enough; do it once, not every build.

If you skip this, `npm run dist` still produces a fully working unpacked app at `release/win-unpacked/Playlist Grabber.exe` — it's just not wrapped in a `Setup.exe` installer yet. Re-running `npx electron-builder --win` (with `CSC_IDENTITY_AUTO_DISCOVERY=false` set) after enabling Developer Mode picks up from there without re-publishing anything.

## Project layout

```
src/
  main.ts       Electron main process: window, menu, IPC handlers, lifecycle
  preload.ts    contextBridge - exposes window.electronAPI to the renderer
  sidecar.ts    spawns/health-checks the backend and frontend child processes
  settings.ts   persisted app settings (download folder, per-install JWT secret)
  constants.ts  fixed sidecar ports
scripts/
  prepare-resources.mjs   publishes backend, builds frontend, bundles ffmpeg -> resources/
  verify-launch.mjs       Playwright-driven smoke test (launch, screenshot, check console errors)
```

## What's not in this build yet

- macOS/Linux packaging (config removed for now since only Windows resources are prepared in this environment — see `package.json`'s `build.win` section; adding `mac`/`linux` back needs their own icons and per-platform `dotnet publish -r osx-*/linux-*` resource prep)
- Code signing (the installer will show an "unknown publisher" SmartScreen prompt until signed)
- Auto-update (no update server wired up; `electron-updater` would be the natural next step)
