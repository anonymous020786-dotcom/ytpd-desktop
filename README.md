# Playlist Grabber — Desktop

A native Windows/macOS/Linux desktop build of Playlist Grabber, wrapping the same ASP.NET Core backend and Next.js frontend from the (separate, private) [ytpd-web](https://github.com/anonymous020786-dotcom/ytpd-web) repo in an Electron shell instead of a browser tab.

**Download:** [Releases](https://github.com/anonymous020786-dotcom/ytpd-desktop/releases) — Windows, macOS (Apple Silicon), and Linux all build and publish automatically via CI on every tagged release.

This repo is deliberately just the native wrapper — window, packaging, sidecar orchestration. The actual download engine (YoutubeExplode/ffmpeg/TagLib# backend, the React UI) lives in `ytpd-web` and isn't duplicated here. To build this, clone `ytpd-web` as a **sibling directory** of this one:

```
some-folder/
  ytpd-web/     <- backend/ and frontend/ live here (private repo)
  ytpd-desktop/ <- this repo
```

`scripts/prepare-resources.mjs` reaches across to `../ytpd-web/backend` and `../ytpd-web/frontend` to publish/build them into this project's `resources/` folder before packaging. Cloned it somewhere else? Set `YTPD_WEB_REPO_PATH` to point at it instead.

## How it works

Electron's main process spawns two local "sidecar" processes bound to `127.0.0.1` on fixed ports, waits for both to come up, then opens a window pointed at the frontend:

- **Backend** (`127.0.0.1:47391`) — the same `YtpdWeb.Api` from `ytpd-web/backend`, published as a self-contained single-file `.exe` (no .NET runtime install required). Runs with `Auth:Disabled=true`, which turns authentication off entirely — no login, no JWT, every endpoint anonymous. That's safe only because this process never binds to anything but loopback.
- **Frontend** (`127.0.0.1:47392`) — the same Next.js app from `ytpd-web/frontend`, built with `output: "standalone"`, with `NEXT_PUBLIC_AUTH_DISABLED=true` (no login screen or logout button) and `NEXT_PUBLIC_API_URL` baked in at build time — the latter set to the fixed backend port above (which is why the port is fixed rather than dynamically chosen — a browser client env var can't be changed after the fact). Hosted by running Electron's own binary in plain-Node mode (`ELECTRON_RUN_AS_NODE=1`) against the standalone `server.js`, so no separate Node.js runtime needs bundling either. Note `package.json` lists `resources/frontend/node_modules` as its **own** `extraResources` entry: electron-builder always drops a `node_modules` folder sitting directly inside a copied directory (no `filter` overrides it), and without it the packaged frontend dies with `Cannot find module 'next'`.
- **ffmpeg** — bundled as a plain binary and pointed to via `Ffmpeg:Path`, since the desktop build can't rely on it being on the end user's `PATH`.

All persistent data (SQLite job history, temp download files, the chosen downloads folder) lives under Electron's `userData` directory, except the downloads folder itself, which defaults to `~/Downloads/Playlist Grabber` and can be changed from the navbar (native folder picker) — picking a new one restarts just the backend sidecar with the new path.

## Updates

New releases (see CI below) reach installed apps through `electron-updater`, which reads the `latest*.yml` files attached to the newest GitHub release. Users choose how under **Help → Updates**:

- **Download and install automatically** (default): checks shortly after launch and then hourly, downloads in the background (differential — usually only a few MB), then offers *Restart now* / *Later*; *Later* installs on the next quit.
- **Ask me before downloading**: shows the new version and its release notes, with *Download and install* / *Remind me later* / *Skip this version*. A skipped version stays quiet in background checks until something newer ships.
- **Only when I check**: no background checks; only **Help → Check for Updates…**, which always answers (including "You're up to date") and still offers a skipped version.

While downloading, progress shows on the taskbar/dock icon. The choice lives in `settings.json` (`updateMode`, `skippedVersion`).

**macOS / non-AppImage Linux:** Squirrel.Mac only installs updates into an app signed with an Apple Developer ID, which this build isn't, and Linux in-place updates need the AppImage. There, the same prompts offer *Open download page* instead of installing.

## Prerequisites

- Node 20+
- .NET 8 SDK (to publish the backend)
- A **static** ffmpeg binary per platform you're building for (not fetched automatically — see below). A package-manager install (Chocolatey shim, Homebrew/apt build) won't work once copied into the app; [`ffmpeg-static`](https://www.npmjs.com/package/ffmpeg-static) is an easy source, and is what CI uses.

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

Builds Windows, macOS (Apple Silicon), and Linux each on their native GitHub-hosted runner, and publishes all three installers to this repo's Releases. Triggers on pushing a tag like `v1.2.3` (or manually from the Actions tab). A 25-minute per-job timeout guards against a runner queue never allocating (see the Intel Mac note below — this actually happened once).

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
  settings.ts   persisted app settings (download folder)
  updater.ts    electron-updater setup: background checks + manual "Check for Updates" flow
  constants.ts  fixed sidecar ports
scripts/
  prepare-resources.mjs   publishes backend + bundles ffmpeg per-platform, builds frontend once -> resources/
  verify-launch.mjs       Playwright-driven smoke test (launch, screenshot, check console errors) - Windows/dev only
.github/workflows/
  release.yml   builds Win/Mac/Linux on their native runners, publishes to Releases on a version tag
```

## What's not in this build yet

- **Code signing on any platform** — this is a real, unavoidable blocker, not a to-do I can just code: Windows needs a paid code-signing certificate (~$200-500/yr from a CA), and macOS needs an Apple Developer Program membership ($99/yr) for `codesign`/notarization. Both require your own identity/payment; until then, Windows shows an "unknown publisher" SmartScreen prompt and macOS needs a Gatekeeper right-click-to-open bypass.
- **Intel Mac (`osx-x64`)** — the code and `prepare-resources.mjs` support it (`YTPD_PLATFORMS=osx-x64`, `YTPD_FFMPEG_OSX_X64`), but it's deliberately not in CI: a `macos-13` job sat queued for 27+ minutes with zero runner ever allocated before being cancelled — GitHub's Intel Mac fleet appears to be effectively unavailable now. Build it manually on real Intel Mac hardware with `npm run dist:mac` if it's ever needed (that script publishes both `osx-arm64` and `osx-x64` when the corresponding `YTPD_FFMPEG_*` vars are set).
- Linux `.deb`/`.rpm` targets (only AppImage right now)
- macOS/Linux builds are produced by CI only — I have no way to execute or visually verify an ELF or Mach-O binary from this Windows machine. Windows builds are the only ones I've actually run and screenshotted; Mac/Linux correctness rests on the build succeeding cleanly and the code being platform-generic (same sidecar/IPC logic, no OS-specific branches beyond paths and binary names).
