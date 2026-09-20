import { execSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(__dirname, "..");
// ytpd-web is a separate (private) repo - clone it as a sibling of this one,
// or point YTPD_WEB_REPO_PATH at wherever you put it.
const webRepoRoot = process.env.YTPD_WEB_REPO_PATH
  ? path.resolve(process.env.YTPD_WEB_REPO_PATH)
  : path.join(desktopRoot, "..", "ytpd-web");
const backendProj = path.join(webRepoRoot, "backend", "YtpdWeb.Api");
const frontendRoot = path.join(webRepoRoot, "frontend");
const resourcesRoot = path.join(desktopRoot, "resources");

if (!existsSync(backendProj) || !existsSync(frontendRoot)) {
  throw new Error(
    `Could not find the ytpd-web repo's backend/frontend under "${webRepoRoot}". ` +
      "Clone https://github.com/anonymous020786-dotcom/ytpd-web as a sibling of this repo, " +
      "or set YTPD_WEB_REPO_PATH to point at it."
  );
}

// Each target: { rid: dotnet RID, dirSuffix: matches sidecar.ts's backendDirName(),
// ffmpegEnv: which env var supplies that platform's static ffmpeg binary,
// ffmpegExeName: filename to copy it as, exeName: published binary's filename }
const PLATFORM_TARGETS = {
  win: { rid: "win-x64", dirSuffix: "win", ffmpegEnv: "YTPD_FFMPEG_WIN", ffmpegExeName: "ffmpeg.exe", exeName: "YtpdWeb.Api.exe" },
  linux: { rid: "linux-x64", dirSuffix: "linux", ffmpegEnv: "YTPD_FFMPEG_LINUX", ffmpegExeName: "ffmpeg", exeName: "YtpdWeb.Api" },
  "osx-x64": { rid: "osx-x64", dirSuffix: "osx-x64", ffmpegEnv: "YTPD_FFMPEG_OSX_X64", ffmpegExeName: "ffmpeg", exeName: "YtpdWeb.Api" },
  "osx-arm64": { rid: "osx-arm64", dirSuffix: "osx-arm64", ffmpegEnv: "YTPD_FFMPEG_OSX_ARM64", ffmpegExeName: "ffmpeg", exeName: "YtpdWeb.Api" },
};

const requested = (process.env.YTPD_PLATFORMS || "win").split(",").map((s) => s.trim());
for (const p of requested) {
  if (!PLATFORM_TARGETS[p]) {
    throw new Error(`Unknown platform "${p}" in YTPD_PLATFORMS. Valid: ${Object.keys(PLATFORM_TARGETS).join(", ")}`);
  }
}

for (const key of requested) {
  const t = PLATFORM_TARGETS[key];
  console.log(`== Publishing backend (self-contained ${t.rid}) ==`);
  const backendOut = path.join(resourcesRoot, `backend-${t.dirSuffix}`);
  rmSync(backendOut, { recursive: true, force: true });
  execSync(
    `dotnet publish "${backendProj}" -c Release -r ${t.rid} --self-contained true ` +
      `-p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o "${backendOut}"`,
    { stdio: "inherit" }
  );
  // dotnet publish sets the exec bit correctly only when run on a matching
  // POSIX host; cross-publishing linux/osx targets from Windows won't set
  // it at all, so force it here (a no-op, harmlessly, on win32).
  if (t.rid !== "win-x64" && process.platform !== "win32") {
    chmodSync(path.join(backendOut, t.exeName), 0o755);
  }

  console.log(`== Bundling ffmpeg for ${key} ==`);
  const ffmpegOut = path.join(resourcesRoot, `ffmpeg-${t.dirSuffix}`);
  mkdirSync(ffmpegOut, { recursive: true });
  const localFfmpeg = process.env[t.ffmpegEnv];
  if (!localFfmpeg || !existsSync(localFfmpeg)) {
    throw new Error(
      `Set ${t.ffmpegEnv} to a static ffmpeg binary for ${key} to bundle. ` +
        "Not fetched automatically so this script never pulls a binary from the network on its own."
    );
  }
  const dest = path.join(ffmpegOut, t.ffmpegExeName);
  cpSync(localFfmpeg, dest);
  if (process.platform !== "win32") chmodSync(dest, 0o755);
}

console.log("== Building frontend (desktop API URL baked in) ==");
execSync("npm run build", {
  cwd: frontendRoot,
  stdio: "inherit",
  env: { ...process.env, NEXT_PUBLIC_API_URL: "http://127.0.0.1:47391" },
});

console.log("== Copying frontend standalone output ==");
const frontendOut = path.join(resourcesRoot, "frontend");
rmSync(frontendOut, { recursive: true, force: true });
mkdirSync(frontendOut, { recursive: true });
cpSync(path.join(frontendRoot, ".next", "standalone"), frontendOut, { recursive: true });
cpSync(path.join(frontendRoot, ".next", "static"), path.join(frontendOut, ".next", "static"), { recursive: true });
if (existsSync(path.join(frontendRoot, "public"))) {
  cpSync(path.join(frontendRoot, "public"), path.join(frontendOut, "public"), { recursive: true });
}

console.log("Resources prepared: " + resourcesRoot);
