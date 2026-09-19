import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
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

console.log("== Publishing backend (self-contained win-x64) ==");
const backendOut = path.join(resourcesRoot, "backend-win");
rmSync(backendOut, { recursive: true, force: true });
execSync(
  `dotnet publish "${backendProj}" -c Release -r win-x64 --self-contained true ` +
    `-p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o "${backendOut}"`,
  { stdio: "inherit" }
);

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

console.log("== Bundling ffmpeg ==");
const ffmpegOut = path.join(resourcesRoot, "ffmpeg");
mkdirSync(ffmpegOut, { recursive: true });
const localFfmpeg = process.env.YTPD_FFMPEG_PATH;
if (!localFfmpeg || !existsSync(localFfmpeg)) {
  throw new Error(
    "Set YTPD_FFMPEG_PATH to a static ffmpeg.exe to bundle (e.g. a Windows build from gyan.dev). " +
      "Not fetched automatically so this script never pulls a binary from the network on its own."
  );
}
cpSync(localFfmpeg, path.join(ffmpegOut, "ffmpeg.exe"));

console.log("Resources prepared: " + resourcesRoot);
