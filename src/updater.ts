import { app, dialog } from "electron";
import { autoUpdater } from "electron-updater";

// electron-updater reads latest.yml from the GitHub release (see
// package.json's build.publish) to compare against app.getVersion(). Only
// meaningful for a packaged build with a real published version - dev runs
// have nothing to compare against and would just log noise.
export function initAutoUpdater() {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("error", (err) => {
    console.error("[updater] error:", err);
  });

  autoUpdater.on("update-available", (info) => {
    console.log("[updater] update available:", info.version);
  });

  autoUpdater.on("update-downloaded", async (info) => {
    const { response } = await dialog.showMessageBox({
      type: "info",
      title: "Update ready",
      message: `Playlist Grabber ${info.version} has been downloaded.`,
      detail: "Restart now to install it, or install it the next time you quit.",
      buttons: ["Restart now", "Later"],
      defaultId: 0,
      cancelId: 1,
    });

    if (response === 0) autoUpdater.quitAndInstall();
  });

  // Fire once on launch, then every few hours for a long-running session.
  autoUpdater.checkForUpdates().catch((err) => console.error("[updater] check failed:", err));
  setInterval(
    () => autoUpdater.checkForUpdates().catch((err) => console.error("[updater] check failed:", err)),
    4 * 60 * 60 * 1000
  );
}

// Unlike the silent background check above, this is for a menu item a user
// clicked directly - it should always say *something* back, even "you're
// already up to date", or the click looks like it did nothing.
export async function checkForUpdatesManual() {
  if (!app.isPackaged) {
    await dialog.showMessageBox({
      type: "info",
      message: "Update checks only run in installed builds, not this dev build.",
    });
    return;
  }

  try {
    const result = await autoUpdater.checkForUpdates();
    const isNewer = result && result.updateInfo.version !== app.getVersion();
    if (!isNewer) {
      await dialog.showMessageBox({
        type: "info",
        message: `You're up to date.`,
        detail: `Playlist Grabber ${app.getVersion()}`,
      });
    }
    // If it IS newer, the "update-available"/"update-downloaded" listeners
    // registered in initAutoUpdater already handle telling the user.
  } catch (err) {
    await dialog.showMessageBox({
      type: "error",
      message: "Could not check for updates.",
      detail: String(err),
    });
  }
}
