#!/usr/bin/env node
// Global "yshare" command (installed with `npm link`).
// Runs the production server from the project folder, building first when needed.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Config, uploads, logs and .next are all resolved from the current folder.
process.chdir(root);

const buildId = path.join(root, ".next", "BUILD_ID");

function newestMtime(target) {
  if (!existsSync(target)) return 0;
  const stat = statSync(target);
  if (!stat.isDirectory()) return stat.mtimeMs;
  let newest = 0;
  for (const entry of readdirSync(target)) newest = Math.max(newest, newestMtime(path.join(target, entry)));
  return newest;
}

function needsBuild() {
  if (!existsSync(buildId)) return true;
  const sources = ["src", "public", "next.config.ts", "package.json"].map((p) => path.join(root, p));
  return Math.max(...sources.map(newestMtime)) > statSync(buildId).mtimeMs;
}

if (process.argv.includes("--rebuild") || needsBuild()) {
  console.log("Membuat build production (sekali saja, tunggu sebentar)...\n");
  const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
  const build = spawnSync(process.execPath, [nextBin, "build"], { stdio: "inherit" });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const server = spawn(process.execPath, ["--import", "tsx", "server.ts"], {
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "production" },
});

// Ctrl+C reaches the server too. Wait for it to clean up its temp files before exiting.
process.on("SIGINT", () => {});
process.on("SIGTERM", () => server.kill("SIGTERM"));
server.on("exit", (code) => process.exit(code ?? 0));
