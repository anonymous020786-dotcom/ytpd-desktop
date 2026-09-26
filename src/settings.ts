import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { app } from "electron";

// How new releases get installed - chosen by the user under Help → Updates.
//   auto:   download in the background, then offer to restart (installs on
//           quit otherwise)
//   ask:    tell the user a new version exists and let them decide
//   manual: never check on its own; only Help → Check for Updates…
export type UpdateMode = "auto" | "ask" | "manual";
export const UPDATE_MODES: readonly UpdateMode[] = ["auto", "ask", "manual"];

export type AppSettings = {
  downloadFolder: string;
  updateMode: UpdateMode;
  // A version the user picked "Skip this version" for - background checks
  // stay quiet about it until something newer ships.
  skippedVersion: string | null;
};

const SETTINGS_PATH = path.join(app.getPath("userData"), "settings.json");

function defaultSettings(): AppSettings {
  return {
    downloadFolder: path.join(app.getPath("downloads"), "Playlist Grabber"),
    updateMode: "auto",
    skippedVersion: null,
  };
}

export function loadSettings(): AppSettings {
  if (existsSync(SETTINGS_PATH)) {
    try {
      const loaded = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8")) as Partial<AppSettings> | null;
      // Only pick known keys, so fields left over from older versions (e.g.
      // the jwtSecret from when the app still had a login) get dropped.
      const defaults = defaultSettings();
      const merged: AppSettings = {
        downloadFolder:
          typeof loaded?.downloadFolder === "string" && loaded.downloadFolder
            ? loaded.downloadFolder
            : defaults.downloadFolder,
        updateMode: UPDATE_MODES.includes(loaded?.updateMode as UpdateMode)
          ? (loaded!.updateMode as UpdateMode)
          : defaults.updateMode,
        skippedVersion: typeof loaded?.skippedVersion === "string" ? loaded.skippedVersion : null,
      };
      if (JSON.stringify(loaded) !== JSON.stringify(merged)) saveSettings(merged);
      return merged;
    } catch {
      // fall through to fresh defaults if the file is corrupt
    }
  }

  const fresh = defaultSettings();
  saveSettings(fresh);
  return fresh;
}

export function saveSettings(settings: AppSettings) {
  mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf-8");
}
