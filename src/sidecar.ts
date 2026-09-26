import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { app } from "electron";
import { BACKEND_PORT, FRONTEND_PORT } from "./constants";
import type { AppSettings } from "./settings";

// Packaged app: electron-builder's extraResources copy resources/backend-<rid>
// -> "backend" inside process.resourcesPath (see package.json). Dev (`npm
// start`, unpackaged): that copy/rename never runs, so this must point at
// the raw per-platform folder `npm run prepare:resources` actually created.
function resourcesPath(): string {
  return app.isPackaged ? process.resourcesPath : path.join(__dirname, "..", "resources");
}

function platformDirSuffix(): string {
  if (process.platform === "win32") return "win";
  if (process.platform === "darwin") return `osx-${process.arch === "arm64" ? "arm64" : "x64"}`;
  return "linux";
}

function backendDirName(): string {
  return app.isPackaged ? "backend" : `backend-${platformDirSuffix()}`;
}

// Same packaged-vs-dev split as the backend: prepare-resources writes
// ffmpeg-<platform>, electron-builder renames it to "ffmpeg" when packaging.
function ffmpegDirName(): string {
  return app.isPackaged ? "ffmpeg" : `ffmpeg-${platformDirSuffix()}`;
}

function backendExeName(): string {
  return process.platform === "win32" ? "YtpdWeb.Api.exe" : "YtpdWeb.Api";
}

function ffmpegExeName(): string {
  return process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
}

// Resolves once `url` answers 2xx. Rejects early if `proc` exits first (e.g.
// the port is already taken or the binary is missing) instead of sitting out
// the whole timeout.
async function waitForHttp(url: string, proc: ChildProcess, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let exitReason: string | null = null;
  const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
    exitReason = `exited with ${signal ?? `code ${code}`}`;
  };
  const onError = (err: Error) => {
    exitReason = `failed to start: ${err.message}`;
  };
  proc.once("exit", onExit);
  proc.once("error", onError);

  try {
    while (Date.now() < deadline) {
      if (exitReason) throw new Error(`${url} never came up - process ${exitReason}`);
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
        if (res.ok) return;
      } catch {
        // not up yet
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error(`Timed out waiting for ${url}`);
  } finally {
    proc.off("exit", onExit);
    proc.off("error", onError);
  }
}

function pipeLogs(proc: ChildProcess, label: string) {
  proc.stdout?.on("data", (d) => console.log(`[${label}] ${d}`.trimEnd()));
  proc.stderr?.on("data", (d) => console.error(`[${label}] ${d}`.trimEnd()));
  // Without an 'error' listener a failed spawn (ENOENT etc.) is an uncaught
  // exception that takes down the whole main process.
  proc.on("error", (err) => console.error(`[${label}] process error:`, err));
}

export async function startBackend(settings: AppSettings): Promise<ChildProcess> {
  const res = resourcesPath();
  const backendExe = path.join(res, backendDirName(), backendExeName());
  const ffmpegExe = path.join(res, ffmpegDirName(), ffmpegExeName());
  const userData = app.getPath("userData");
  mkdirSync(settings.downloadFolder, { recursive: true });

  const proc = spawn(backendExe, [], {
    env: {
      ...process.env,
      ASPNETCORE_URLS: `http://127.0.0.1:${BACKEND_PORT}`,
      ASPNETCORE_ENVIRONMENT: "Production",
      // Loopback-only, single local user: no login, no JWT.
      Auth__Disabled: "true",
      Storage__TempPath: path.join(userData, "temp"),
      Storage__DownloadsPath: settings.downloadFolder,
      Database__Path: path.join(userData, "ytpd.db"),
      Ffmpeg__Path: ffmpegExe,
      Cors__AllowedOrigin: `http://127.0.0.1:${FRONTEND_PORT}`,
    },
    stdio: "pipe",
    windowsHide: true,
  });
  pipeLogs(proc, "backend");

  try {
    await waitForHttp(`http://127.0.0.1:${BACKEND_PORT}/healthz`, proc, 30_000);
  } catch (err) {
    await stopProcess(proc);
    throw err;
  }
  return proc;
}

export async function startFrontend(): Promise<ChildProcess> {
  const res = resourcesPath();
  const serverJs = path.join(res, "frontend", "server.js");

  // Run the bundled Electron binary as a plain Node process (no separate
  // Node.js runtime to ship) to host the Next.js standalone server.
  const proc = spawn(process.execPath, [serverJs], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      PORT: String(FRONTEND_PORT),
      HOSTNAME: "127.0.0.1",
    },
    stdio: "pipe",
    windowsHide: true,
  });
  pipeLogs(proc, "frontend");

  try {
    await waitForHttp(`http://127.0.0.1:${FRONTEND_PORT}/`, proc, 30_000);
  } catch (err) {
    await stopProcess(proc);
    throw err;
  }
  return proc;
}

// Kills `proc` and resolves once it has actually exited, so its port is free
// again before anything tries to rebind it. Falls back to SIGKILL if it
// ignores the polite signal.
export function stopProcess(proc: ChildProcess | null, timeoutMs = 5_000): Promise<void> {
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve();

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      resolve();
    }, timeoutMs);
    proc.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    proc.kill();
  });
}
