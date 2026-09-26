import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { app } from "electron";

export type AppSettings = {
  downloadFolder: string;
};

const SETTINGS_PATH = path.join(app.getPath("userData"), "settings.json");

function defaultSettings(): AppSettings {
  return {
    downloadFolder: path.join(app.getPath("downloads"), "Playlist Grabber"),
  };
}

export function loadSettings(): AppSettings {
  if (existsSync(SETTINGS_PATH)) {
    try {
      const loaded = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8")) as Partial<AppSettings> | null;
      // Only pick known keys, so fields left over from older versions (e.g.
      // the jwtSecret from when the app still had a login) get dropped.
      const merged: AppSettings = {
        downloadFolder:
          typeof loaded?.downloadFolder === "string" && loaded.downloadFolder
            ? loaded.downloadFolder
            : defaultSettings().downloadFolder,
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
