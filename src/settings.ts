import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { app } from "electron";

export type AppSettings = {
  downloadFolder: string;
  // Generated once per install so restarting the backend (e.g. after
  // changing the download folder) doesn't invalidate an already-issued
  // token in the renderer.
  jwtSecret: string;
};

const SETTINGS_PATH = path.join(app.getPath("userData"), "settings.json");

function defaultSettings(): AppSettings {
  return {
    downloadFolder: path.join(app.getPath("downloads"), "Playlist Grabber"),
    jwtSecret: randomBytes(48).toString("base64"),
  };
}

export function loadSettings(): AppSettings {
  if (existsSync(SETTINGS_PATH)) {
    try {
      const loaded = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8")) as Partial<AppSettings>;
      const merged = { ...defaultSettings(), ...loaded };
      if (!loaded.jwtSecret || !loaded.downloadFolder) saveSettings(merged);
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
