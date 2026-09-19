// One-shot verification: launch the packaged-shape app, wait for the real
// window, screenshot it, and dump console errors. Not a full driver - just
// enough to prove the sidecar architecture actually works end to end.
import { _electron as electron } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(__dirname, "..");
const shotDir = path.join(appDir, "verify-shots");
fs.mkdirSync(shotDir, { recursive: true });

const electronBin = path.join(appDir, "node_modules", "electron", "dist", "electron.exe");

const consoleErrors = [];

// This shell's environment has ELECTRON_RUN_AS_NODE=1 set (inherited from
// the agent host process), which forces any Electron binary launched here
// to run as plain Node instead of a real app. Strip it for the child.
const cleanEnv = { ...process.env };
delete cleanEnv.ELECTRON_RUN_AS_NODE;

console.log("Launching...");
const app = await electron.launch({
  executablePath: electronBin,
  args: [appDir],
  env: cleanEnv,
  timeout: 60_000,
});

app.process().stdout?.on("data", (d) => process.stdout.write(`[main stdout] ${d}`));
app.process().stderr?.on("data", (d) => process.stderr.write(`[main stderr] ${d}`));

app.on("window", async (win) => {
  win.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
});

console.log("Waiting for main window...");
const page = await app.firstWindow({ timeout: 60_000 });
await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});

console.log("URL:", page.url());
await page.screenshot({ path: path.join(shotDir, "01-initial.png") });
console.log("Screenshot 1 saved.");

// Should already be auto-logged-in (LocalMode) and past the login screen -
// wait for the dashboard's URL-resolve card as proof.
try {
  await page.waitForSelector("text=Paste a YouTube link", { timeout: 20_000 });
  console.log("Dashboard reached.");
} catch {
  console.log("Did not reach dashboard within timeout.");
}

await page.screenshot({ path: path.join(shotDir, "02-dashboard.png") });
console.log("Screenshot 2 saved.");

console.log("Console errors:", consoleErrors.length ? consoleErrors : "(none)");

await app.close();
console.log("Done.");
