# Playlist Grabber — Desktop

A native Windows/macOS/Linux desktop build of Playlist Grabber, wrapping the same ASP.NET Core backend and Next.js frontend from the (separate, private) [ytpd-web](https://github.com/anonymous020786-dotcom/ytpd-web) repo in an Electron shell instead of a browser tab.

**Download:** [Releases](https://github.com/anonymous020786-dotcom/ytpd-desktop/releases) — Windows installer is live; macOS/Linux build via CI (see below).

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
- A static ffmpeg binary per platform you're building for (not fetched automatically — see below)

## Building

```bash
npm install
```

**Dev mode** (runs `dist/*.js` directly against whatever's in `resources/`, which you must have already prepared at least once):

```bash
YTPD_FFMPEG_WIN=/path/to/ffmpeg.exe npm run prepare:resources   # publishes backend, builds frontend, bundles ffmpeg
npm start
```

**Production installer, per platform** (env var names: `YTPD_FFMPEG_WIN`, `YTPD_FFMPEG_LINUX`, `YTPD_FFMPEG_OSX_X64`, `YTPD_FFMPEG_OSX_ARM64` — only the ones for platforms in `YTPD_PLATFORMS` are required):

```bash
YTPD_FFMPEG_WIN=/path/to/ffmpeg.exe npm run dist:win
```

`YTPD_PLATFORMS` (comma-separated: `win`, `linux`, `osx-x64`, `osx-arm64`) controls which backend RIDs `prepare:resources` publishes; `npm run dist:win`/`dist:linux`/`dist:mac` set it for you and pass the matching `electron-builder` target flag.

### macOS and Linux can only be built on their own OS

Confirmed firsthand, not a guess: AppImage's packaging tool (`mksquashfs`) is a Linux ELF binary — it cannot run on Windows at all, full stop. macOS `.dmg`/code-signing tooling (`hdiutil`, `codesign`) is Apple-only in the same way. There's no cross-compilation workaround for either; **use the CI workflow below**, or build directly on a real Mac/Linux machine.

### CI: `.github/workflows/release.yml`

Builds Windows, macOS, and Linux each on their native GitHub-hosted runner, and publishes all three installers to this repo's Releases. Triggers on pushing a tag like `v1.2.3` (or manually from the Actions tab).

**One-time setup:** add a repository secret named `YTPD_WEB_PAT` — a fine-grained GitHub PAT with read-only **Contents** access to the private `ytpd-web` repo (Settings → Secrets and variables → Actions → New repository secret). The workflow checks that repo out as a sibling directory to reach its backend/frontend, the same as building locally.

### Known issue (Windows only): NSIS installer step needs Developer Mode or an admin shell

electron-builder unconditionally tries to download and extract a macOS code-signing tools archive (`winCodeSign`) even for a Windows-only build — a [known electron-builder quirk](https://github.com/electron-userland/electron-builder/issues/8242) unrelated to this app. Extracting it creates symlinks, which standard (non-elevated) Windows accounts can't do without **Developer Mode** enabled (Settings → Privacy & Security → For Developers), or running the build from an **Administrator** terminal. Either one is enough; do it once, not every build. If the CI workflow above ever hits this same error on `windows-latest`, that's the fix to apply there too (untested — this repo's own Windows release was built locally after enabling Developer Mode, not via CI).

If you skip this locally, `npm run dist:win` still produces a fully working unpacked app at `release/win-unpacked/Playlist Grabber.exe` — it's just not wrapped in a `Setup.exe` installer yet.

## Project layout

```
src/
  main.ts       Electron main process: window, menu, IPC handlers, lifecycle, auto-updater wiring
  preload.ts    contextBridge - exposes window.electronAPI to the renderer
  sidecar.ts    spawns/health-checks the backend and frontend child processes (platform-aware)
  settings.ts   persisted app settings (download folder, per-install JWT secret)
  updater.ts    electron-updater setup: background checks + manual "Check for Updates" flow
  constants.ts  fixed sidecar ports
scripts/
  prepare-resources.mjs   publishes backend + bundles ffmpeg per-platform, builds frontend once -> resources/
  verify-launch.mjs       Playwright-driven smoke test (launch, screenshot, check console errors) - Windows/dev only
.github/workflows/
  release.yml   builds Win/Mac/Linux on their native runners, publishes to Releases on a version tag
```

## What's not in this build yet

- Code signing on any platform (Windows shows an "unknown publisher" SmartScreen prompt; unsigned macOS builds need a Gatekeeper right-click-to-open bypass)
- macOS x64 (Intel) builds — CI currently only builds `osx-arm64`; add an `os: macos-13` matrix entry with `platforms: osx-x64` to the workflow for Intel support
- Linux `.deb`/`.rpm` targets (only AppImage right now)
