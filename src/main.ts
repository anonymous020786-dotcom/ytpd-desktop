import type { ChildProcess } from "node:child_process";
import path from "node:path";
import { app, BrowserWindow, dialog, ipcMain, Menu, type MenuItemConstructorOptions, shell } from "electron";
import { FRONTEND_URL } from "./constants";
import { startBackend, startFrontend, stopProcess } from "./sidecar";
import { type AppSettings, loadSettings, saveSettings } from "./settings";
import { checkForUpdatesManual, initAutoUpdater } from "./updater";

let mainWindow: BrowserWindow | null = null;
let backendProc: ChildProcess | null = null;
let frontendProc: ChildProcess | null = null;
let settings: AppSettings;

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: "Playlist Grabber",
    backgroundColor: "#0a0a0a",
    icon: path.join(__dirname, "..", "build", "icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
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
    shell.openExternal(url);
    return { action: "deny" };
  });

  await mainWindow.loadURL(FRONTEND_URL);
}

function buildMenu() {
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
          label: `Version ${app.getVersion()}`,
          enabled: false,
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function restartBackendWithNewFolder(folder: string) {
  settings = { ...settings, downloadFolder: folder };
  saveSettings(settings);
  stopProcess(backendProc);
  backendProc = await startBackend(settings);
}

app.whenReady().then(async () => {
  settings = loadSettings();

  try {
    backendProc = await startBackend(settings);
    frontendProc = await startFrontend();
  } catch (err) {
    console.error("Startup failed:", err);
    dialog.showErrorBox("Playlist Grabber failed to start", String(err));
    app.quit();
    return;
  }

  buildMenu();
  await createWindow();
  initAutoUpdater();

  ipcMain.handle("get-download-folder", () => settings.downloadFolder);

  ipcMain.handle("choose-download-folder", async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory", "createDirectory"],
      defaultPath: settings.downloadFolder,
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const folder = result.filePaths[0];
    await restartBackendWithNewFolder(folder);
    return folder;
  });

  ipcMain.handle("open-path", (_event, targetPath: string) => shell.openPath(targetPath));

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  stopProcess(backendProc);
  stopProcess(frontendProc);
});
