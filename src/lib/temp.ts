import fs from "node:fs";
import path from "node:path";
import { getState } from "./state";
import { TEMP_PREFIX, TEMP_SUFFIX } from "./paths";

// Every temp file is listed here while it's being written. If the server is killed mid-upload,
// the next start deletes whatever is still listed, without having to scan the root folders.
// One file per port, so two yshare instances never delete each other's temp files.
const manifestPath = () => path.resolve(`.yshare-pending-${getState().config.server.port}.json`);

function isTempFile(file: string): boolean {
  const base = path.basename(file);
  return base.startsWith(TEMP_PREFIX) && base.endsWith(TEMP_SUFFIX);
}

function writeManifest(): void {
  try {
    fs.writeFileSync(manifestPath(), JSON.stringify([...getState().activeTemps], null, 2));
  } catch (err) {
    console.error("Gagal menulis daftar file sementara:", err);
  }
}

export function registerTemp(file: string): void {
  getState().activeTemps.add(file);
  writeManifest();
}

export function unregisterTemp(file: string): void {
  if (getState().activeTemps.delete(file)) writeManifest();
}

/** Deletes temp files left behind by a previous run. Returns how many were removed. */
export function cleanupLeftoverTemps(): number {
  let removed = 0;
  let files: unknown;
  try {
    files = JSON.parse(fs.readFileSync(manifestPath(), "utf8"));
  } catch {
    return 0;
  }
  if (Array.isArray(files)) {
    for (const file of files) {
      if (typeof file !== "string" || !isTempFile(file)) continue;
      try {
        fs.rmSync(file, { force: true });
        removed++;
      } catch {
        // Locked or already gone; nothing else to do.
      }
    }
  }
  fs.rmSync(manifestPath(), { force: true });
  return removed;
}

/** Called on Ctrl+C so stopping the server mid-upload leaves no `.part` files behind. */
export function removeActiveTempsSync(): void {
  const state = getState();
  for (const file of state.activeTemps) {
    try {
      fs.rmSync(file, { force: true });
    } catch {
      // Stream may still hold the file open; the manifest cleanup will retry next start.
      continue;
    }
    state.activeTemps.delete(file);
  }
  if (state.activeTemps.size === 0) fs.rmSync(manifestPath(), { force: true });
  else writeManifest();
}
