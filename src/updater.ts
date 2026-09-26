import { app, type BrowserWindow, dialog, type MessageBoxOptions, shell } from "electron";
import { autoUpdater, type ProgressInfo, type UpdateInfo } from "electron-updater";
import type { AppSettings, UpdateMode } from "./settings";

// electron-updater reads latest*.yml from the newest GitHub release (see
// package.json's build.publish) and compares it against app.getVersion().

const RELEASES_URL = "https://github.com/anonymous020786-dotcom/ytpd-desktop/releases/latest";
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

type UpdaterHost = {
  getSettings: () => AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => void;
  getWindow: () => BrowserWindow | null;
};

type State =
  | { kind: "idle" }
  | { kind: "checking"; userInitiated: boolean }
  | { kind: "available"; info: UpdateInfo }
  | { kind: "downloading"; info: UpdateInfo; percent: number; userInitiated: boolean }
  | { kind: "downloaded"; info: UpdateInfo };

let host: UpdaterHost | null = null;
let state: State = { kind: "idle" };
// Avoids stacking a second "update available" prompt on top of one that's
// still open (e.g. hourly check fires while the user hasn't answered yet).
let promptOpen = false;

// Squirrel.Mac refuses to install an update into an app that isn't signed
// with an Apple Developer ID (this project's Mac build isn't), and the
// Linux updater only works when running as an AppImage. On those, updates
// are "notify + open the download page" instead of installed in place.
function canInstallInPlace() {
  if (process.platform === "darwin") return false;
  if (process.platform === "linux") return Boolean(process.env.APPIMAGE);
  return true;
}

function showBox(options: MessageBoxOptions) {
  const win = host?.getWindow();
  return win && !win.isDestroyed() ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options);
}

function setTaskbarProgress(fraction: number) {
  const win = host?.getWindow();
  if (win && !win.isDestroyed()) win.setProgressBar(fraction);
}

// GitHub hands release notes over as HTML; a native dialog needs plain text.
function releaseNotesText(info: UpdateInfo): string {
  const raw = Array.isArray(info.releaseNotes)
    ? info.releaseNotes.map((n) => n.note ?? "").join("\n\n")
    : (info.releaseNotes ?? "");
  const text = raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|h\d)>/gi, "\n")
    .replace(/<li>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length > 700 ? `${text.slice(0, 700).trimEnd()}…` : text;
}

function startDownload(info: UpdateInfo, userInitiated: boolean) {
  if (state.kind === "downloading" || state.kind === "downloaded") return;
  state = { kind: "downloading", info, percent: 0, userInitiated };
  setTaskbarProgress(0);
  autoUpdater.downloadUpdate().catch((err) => {
    // The "error" listener reports it; just make sure state recovers.
    console.error("[updater] download failed:", err);
  });
}

async function offerUpdate(info: UpdateInfo, userInitiated: boolean) {
  if (promptOpen) return;
  promptOpen = true;
  try {
    const inPlace = canInstallInPlace();
    const notes = releaseNotesText(info);
    const { response } = await showBox({
      type: "info",
      title: "Update available",
      message: `Playlist Grabber ${info.version} is available`,
      detail:
        `You have ${app.getVersion()}.` +
        (notes ? `\n\nWhat's new:\n${notes}` : "") +
        (inPlace ? "" : "\n\nOn this system the update is installed by downloading it from the releases page."),
      buttons: [inPlace ? "Download and install" : "Open download page", "Remind me later", "Skip this version"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });

    if (response === 0) {
      host?.updateSettings({ skippedVersion: null });
      if (inPlace) startDownload(info, true);
      else shell.openExternal(RELEASES_URL);
    } else if (response === 2) {
      host?.updateSettings({ skippedVersion: info.version });
      state = { kind: "idle" };
    }
    // "Remind me later": leave state as "available" - the next check (or a
    // switch to automatic mode) picks it up again.
  } finally {
    promptOpen = false;
  }
}

async function offerRestart(info: UpdateInfo) {
  if (promptOpen) return;
  promptOpen = true;
  try {
    const { response } = await showBox({
      type: "info",
      title: "Update ready",
      message: `Playlist Grabber ${info.version} is ready to install`,
      detail: "Restart now to finish updating, or it will install automatically the next time you quit.",
      buttons: ["Restart now", "Later"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    // isSilent=false shows the installer's progress; isForceRunAfter=true
    // relaunches the app when it's done.
    if (response === 0) setImmediate(() => autoUpdater.quitAndInstall(false, true));
  } finally {
    promptOpen = false;
  }
}

function onUpdateAvailable(info: UpdateInfo) {
  const settings = host!.getSettings();
  const userInitiated = state.kind === "checking" && state.userInitiated;
  if (state.kind === "downloading" || state.kind === "downloaded") return;
  state = { kind: "available", info };

  // A background check stays quiet about a version the user chose to skip.
  if (!userInitiated && settings.skippedVersion === info.version) return;

  if (settings.updateMode === "auto" && canInstallInPlace() && !userInitiated) {
    startDownload(info, false);
  } else {
    void offerUpdate(info, userInitiated);
  }
}

async function check(userInitiated: boolean) {
  if (state.kind === "checking" || state.kind === "downloading" || state.kind === "downloaded") return null;
  const previous = state;
  state = { kind: "checking", userInitiated };
  try {
    const result = await autoUpdater.checkForUpdates();
    // No update (or older remote version): "update-available" never fired,
    // so reset from "checking" here.
    if (state.kind === "checking") state = previous.kind === "available" ? previous : { kind: "idle" };
    return result;
  } catch (err) {
    if (state.kind === "checking") state = { kind: "idle" };
    throw err;
  }
}

function backgroundCheck() {
  if (host?.getSettings().updateMode === "manual") return;
  check(false).catch((err) => console.error("[updater] background check failed:", err));
}

export function initAutoUpdater(updaterHost: UpdaterHost) {
  host = updaterHost;
  if (!app.isPackaged) return;

  // Downloads are always started explicitly (startDownload), so the chosen
  // mode decides - never electron-updater's own default.
  autoUpdater.autoDownload = false;
  // Only ever applies to an update that was already downloaded, which in
  // "ask"/"manual" mode only happens after the user agreed to it.
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", onUpdateAvailable);

  autoUpdater.on("download-progress", (progress: ProgressInfo) => {
    if (state.kind === "downloading") state = { ...state, percent: progress.percent };
    setTaskbarProgress(progress.percent / 100);
  });

  autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
    state = { kind: "downloaded", info };
    setTaskbarProgress(-1);
    void offerRestart(info);
  });

  autoUpdater.on("error", (err) => {
    console.error("[updater] error:", err);
    setTaskbarProgress(-1);
    const wasUserDownload = state.kind === "downloading" && state.userInitiated;
    if (state.kind === "downloading") state = { kind: "available", info: state.info };
    if (wasUserDownload) {
      void showBox({ type: "error", message: "The update couldn't be downloaded.", detail: String(err) });
    }
  });

  // Once shortly after launch (not during startup itself), then hourly.
  setTimeout(backgroundCheck, 10_000);
  setInterval(backgroundCheck, CHECK_INTERVAL_MS);
}

// Called when the user picks a different option under Help → Updates.
export function setUpdateMode(mode: UpdateMode) {
  host?.updateSettings({ updateMode: mode });
  if (!app.isPackaged) return;
  // Switching to automatic with an update already found: start on it now
  // rather than waiting for the next hourly check.
  if (mode === "auto" && state.kind === "available" && canInstallInPlace()) startDownload(state.info, false);
  else if (mode !== "manual" && state.kind === "idle") backgroundCheck();
}

// Help → Check for Updates…: unlike the background checks, a click must
// always get *some* answer, even "you're up to date".
export async function checkForUpdatesManual() {
  if (!app.isPackaged) {
    await showBox({ type: "info", message: "Update checks only run in installed builds, not this dev build." });
    return;
  }

  if (state.kind === "downloaded") return offerRestart(state.info);
  if (state.kind === "downloading") {
    await showBox({
      type: "info",
      message: `Downloading Playlist Grabber ${state.info.version}… (${Math.round(state.percent)}%)`,
      detail: "You'll be asked to restart when it's ready.",
    });
    return;
  }
  if (state.kind === "available") return offerUpdate(state.info, true);

  try {
    const result = await check(true);
    if (!result?.isUpdateAvailable) {
      await showBox({ type: "info", message: "You're up to date.", detail: `Playlist Grabber ${app.getVersion()}` });
    }
    // Otherwise onUpdateAvailable has already offered it.
  } catch (err) {
    await showBox({ type: "error", message: "Could not check for updates.", detail: String(err) });
  }
}
