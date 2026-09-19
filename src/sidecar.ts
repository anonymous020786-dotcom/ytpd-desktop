import { type ChildProcess, spawn } from "node:child_process";
import path from "node:path";
import { app } from "electron";
import { BACKEND_PORT, FRONTEND_PORT } from "./constants";
import type { AppSettings } from "./settings";

// Packaged app: electron-builder's extraResources copy resources/backend-win
// -> "backend" inside process.resourcesPath (see package.json). Dev (`npm
// start`, unpackaged): that copy/rename never runs, so this must point at
// the raw folder `npm run prepare:resources` actually created on disk.
function resourcesPath(): string {
  return app.isPackaged ? process.resourcesPath : path.join(__dirname, "..", "resources");
}

function backendDirName(): string {
  return app.isPackaged ? "backend" : "backend-win";
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

export async function startBackend(settings: AppSettings): Promise<ChildProcess> {
  const res = resourcesPath();
  const backendExe = path.join(res, backendDirName(), "YtpdWeb.Api.exe");
  const ffmpegExe = path.join(res, "ffmpeg", "ffmpeg.exe");
  const userData = app.getPath("userData");

  const proc = spawn(backendExe, [], {
    env: {
      ...process.env,
      ASPNETCORE_URLS: `http://127.0.0.1:${BACKEND_PORT}`,
      ASPNETCORE_ENVIRONMENT: "Production",
      Jwt__Secret: settings.jwtSecret,
      Auth__LocalMode: "true",
      Storage__TempPath: path.join(userData, "temp"),
      Storage__DownloadsPath: settings.downloadFolder,
      Database__Path: path.join(userData, "ytpd.db"),
      Ffmpeg__Path: ffmpegExe,
      Cors__AllowedOrigin: `http://127.0.0.1:${FRONTEND_PORT}`,
    },
    stdio: "pipe",
  });

  proc.stdout?.on("data", (d) => console.log(`[backend] ${d}`.trimEnd()));
  proc.stderr?.on("data", (d) => console.error(`[backend] ${d}`.trimEnd()));

  await waitForHttp(`http://127.0.0.1:${BACKEND_PORT}/healthz`, 30_000);
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
  });

  proc.stdout?.on("data", (d) => console.log(`[frontend] ${d}`.trimEnd()));
  proc.stderr?.on("data", (d) => console.error(`[frontend] ${d}`.trimEnd()));

  await waitForHttp(`http://127.0.0.1:${FRONTEND_PORT}/login`, 30_000);
  return proc;
}

export function stopProcess(proc: ChildProcess | null) {
  if (!proc || proc.killed) return;
  proc.kill();
}
