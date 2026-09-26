import type { ChildProcess } from "node:child_process";
import path from "node:path";
import { app, BrowserWindow, dialog, ipcMain, Menu, type MenuItemConstructorOptions, shell } from "electron";
import { FRONTEND_URL } from "./constants";
import { startBackend, startFrontend, stopProcess } from "./sidecar";
import { type AppSettings, loadSettings, saveSettings, type UpdateMode } from "./settings";
import { checkForUpdatesManual, initAutoUpdater, setUpdateMode } from "./updater";

let mainWindow: BrowserWindow | null = null;
let backendProc: ChildProcess | null = null;
let frontendProc: ChildProcess | null = null;
let settings: AppSettings;
let isQuitting = false;
// Set while the backend is being deliberately restarted, so its exit isn't
// reported as a crash.
let restartingBackend: Promise<void> | null = null;

function isAppUrl(url: string) {
  try {
    return new URL(url).origin === new URL(FRONTEND_URL).origin;
  } catch {
    return false;
  }
}

function openExternalSafely(url: string) {
  try {
    const { protocol } = new URL(url);
    if (protocol === "http:" || protocol === "https:") shell.openExternal(url);
  } catch {
    // not a URL - ignore
  }
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: "Playlist Grabber",
    backgroundColor: "#0a0a0a",
    // Windows/macOS take the icon from the packaged executable/bundle; Linux
    // needs it set on the window explicitly.
    ...(process.platform === "linux" ? { icon: path.join(__dirname, "..", "build", "icon.png") } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    show: false,
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Anything that would open a new window (e.g. a target=_blank link) opens
  // in the system browser instead of a second Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url);
    return { action: "deny" };
  });

  // Same for in-place navigation away from the bundled frontend - the app
  // window should never turn into a general-purpose browser.
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    openExternalSafely(url);
  });

  await mainWindow.loadURL(FRONTEND_URL);
}

const UPDATE_MODE_LABELS: Record<UpdateMode, string> = {
  auto: "Download and install automatically",
  ask: "Ask me before downloading",
  manual: "Only when I check",
};

function buildMenu() {
  const updateModeItems: MenuItemConstructorOptions[] = (Object.keys(UPDATE_MODE_LABELS) as UpdateMode[]).map(
    (mode) => ({
      label: UPDATE_MODE_LABELS[mode],
      type: "radio",
      checked: settings.updateMode === mode,
      click: () => setUpdateMode(mode),
    })
  );

  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
    { role: "editMenu" as const },
    { role: "viewMenu" as const },
    { role: "windowMenu" as const },
    {
      label: "Downloads",
      submenu: [
        {
          label: "Open downloads folder",
          click: () => shell.openPath(settings.downloadFolder),
        },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Check for Updates…",
          click: () => checkForUpdatesManual(),
        },
        {
          label: "Updates",
          submenu: updateModeItems,
        },
        { type: "separator" },
        {
          label: `Version ${app.getVersion()}`,
          enabled: false,
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function watchSidecar(proc: ChildProcess, name: string) {
  proc.once("exit", (code, signal) => {
    if (isQuitting || restartingBackend || (proc !== backendProc && proc !== frontendProc)) return;
    dialog.showErrorBox(
      "Playlist Grabber stopped unexpectedly",
      `The ${name} process exited (${signal ?? `code ${code}`}). The app will now close - please reopen it.`
    );
    app.quit();
  });
}

async function launchBackend() {
  backendProc = await startBackend(settings);
  watchSidecar(backendProc, "download engine");
}

async function restartBackendWithNewFolder(folder: string) {
  const previousFolder = settings.downloadFolder;
  const doRestart = async () => {
    await stopProcess(backendProc);
    settings = { ...settings, downloadFolder: folder };
    try {
      await launchBackend();
      saveSettings(settings);
    } catch (err) {
      // New folder didn't work (e.g. not writable) - go back to the old one
      // rather than leaving the app with no backend at all.
      settings = { ...settings, downloadFolder: previousFolder };
      await launchBackend();
      throw err;
    }
  };

  // Serialize: a second folder change while one is still restarting waits
  // for it instead of racing it for the port.
  const run = (restartingBackend ?? Promise.resolve()).then(doRestart);
  const tracked = run.finally(() => {
    if (restartingBackend === tracked) restartingBackend = null;
  });
  restartingBackend = tracked.catch(() => {});
  await tracked;
}

function isInside(child: string, parent: string) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function registerIpcHandlers() {
  ipcMain.handle("get-download-folder", () => settings.downloadFolder);

  ipcMain.handle("choose-download-folder", async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory", "createDirectory"],
      defaultPath: settings.downloadFolder,
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const folder = result.filePaths[0];
    if (folder === settings.downloadFolder) return folder;
    try {
      await restartBackendWithNewFolder(folder);
    } catch (err) {
      dialog.showErrorBox("Could not use that folder", String(err));
      return null;
    }
    return folder;
  });

  // Only ever opens things inside the downloads folder - shell.openPath on
  // an arbitrary path would happily launch executables.
  ipcMain.handle("open-path", async (_event, targetPath: unknown) => {
    if (typeof targetPath !== "string" || !isInside(targetPath, settings.downloadFolder)) {
      return "Refusing to open a path outside the downloads folder.";
    }
    return shell.openPath(targetPath);
  });
}

function killSidecars() {
  // Synchronous best-effort kill: before-quit can't await, and on Windows
  // kill() is an immediate TerminateProcess anyway.
  for (const proc of [backendProc, frontendProc]) {
    if (proc && proc.exitCode === null && proc.signalCode === null) proc.kill();
  }
}

// Both sidecars bind fixed ports, so a second copy of the app would find
// them taken (or worse, talk to the first copy's backend). Focus the
// existing window instead.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    settings = loadSettings();
    registerIpcHandlers();

    try {
      await launchBackend();
      frontendProc = await startFrontend();
      watchSidecar(frontendProc, "interface");
    } catch (err) {
      console.error("Startup failed:", err);
      dialog.showErrorBox("Playlist Grabber failed to start", String(err));
      app.quit();
      return;
    }

    buildMenu();
    await createWindow();
    initAutoUpdater({
      getSettings: () => settings,
      updateSettings: (patch) => {
        settings = { ...settings, ...patch };
        saveSettings(settings);
      },
      getWindow: () => mainWindow,
    });

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", () => {
    isQuitting = true;
    killSidecars();
  });
}
