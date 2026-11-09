import fs from "node:fs/promises";
import path from "node:path";
import { formatBytes } from "./format";

const LOG_FILE = path.resolve("logs", "uploads.log");

export type UploadLogEntry = {
  ip: string;
  root: string;
  path: string;
  name: string;
  size: number;
  status: "saved" | "skipped" | "failed" | "aborted" | "interrupted";
  ms: number;
  error?: string;
};

const STATUS_LABEL: Record<UploadLogEntry["status"], string> = {
  saved: "✔ tersimpan",
  skipped: "↷ dilewati",
  failed: "✖ gagal",
  aborted: "■ dibatalkan",
  interrupted: "⏸ terputus",
};

export function logUpload(entry: UploadLogEntry): void {
  const where = [entry.root, entry.path].filter(Boolean).join("/");
  const detail = entry.error ? ` (${entry.error})` : "";
  console.log(
    `[upload] ${STATUS_LABEL[entry.status]}  ${entry.name}  ${formatBytes(entry.size)}  → ${where}  dari ${entry.ip}${detail}`,
  );

  const line = JSON.stringify({ time: new Date().toISOString(), ...entry }) + "\n";
  fs.mkdir(path.dirname(LOG_FILE), { recursive: true })
    .then(() => fs.appendFile(LOG_FILE, line))
    .catch((err) => console.error("Gagal menulis log upload:", err));
}
