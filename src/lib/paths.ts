import fs from "node:fs/promises";
import path from "node:path";
import type { Root } from "./config";

// Characters Windows forbids in names, plus control characters. `/` and `\` are separators.
const INVALID_CHARS = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;
const HAS_INVALID_CHARS = /[<>:"/\\|?*\u0000-\u001f\u007f]/;
// Windows device names are reserved even with an extension (`CON.txt`).
const RESERVED_NAMES = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;
/** Prefix of in-progress upload files. Users can't create names that look like them. */
export const TEMP_PREFIX = ".yshare-";
export const TEMP_SUFFIX = ".part";

// Leaves room for " (123)" suffixes and stays under 255 on every filesystem.
const MAX_NAME_CHARS = 200;
const MAX_NAME_BYTES = 240;
const MAX_DEPTH = 64;

export class PathError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function truncateName(name: string): string {
  const fits = (value: string) =>
    value.length <= MAX_NAME_CHARS && Buffer.byteLength(value, "utf8") <= MAX_NAME_BYTES;
  if (fits(name)) return name;

  const rawExt = path.extname(name);
  const ext = rawExt.length <= 20 ? rawExt : "";
  const base = Array.from(ext ? name.slice(0, -ext.length) : name);
  while (base.length > 0 && !fits(base.join("") + ext)) base.pop();
  return base.join("").trimEnd() + ext;
}

/**
 * Turns a name sent by the browser into a safe single path segment. Invalid characters become
 * `_` instead of failing, because phones often produce odd names. Returns null if nothing usable
 * is left.
 */
export function sanitizeFileName(input: string): string | null {
  let name = input.normalize("NFC").replace(INVALID_CHARS, "_").trim();
  name = name.replace(/[. ]+$/, ""); // Windows silently drops trailing dots and spaces
  if (!name) return null;
  if (name.toLowerCase().startsWith(TEMP_PREFIX)) name = `_${name}`;
  if (RESERVED_NAMES.test(name)) name = `_${name}`;
  name = truncateName(name);
  return name || null;
}

export type NameCheck = { ok: true; name: string } | { ok: false; error: string };

/** Folder names typed by the user are rejected (not silently changed) so they get what they typed. */
export function validateFolderName(input: string): NameCheck {
  const name = input.normalize("NFC").trim();
  if (!name) return { ok: false, error: "Nama folder tidak boleh kosong." };
  if (HAS_INVALID_CHARS.test(name)) {
    return { ok: false, error: 'Nama folder tidak boleh berisi \\ / : * ? " < > |' };
  }
  if (name === "." || name === "..") return { ok: false, error: "Nama folder tidak valid." };
  if (/[. ]$/.test(name)) return { ok: false, error: "Nama folder tidak boleh diakhiri titik atau spasi." };
  if (RESERVED_NAMES.test(name)) return { ok: false, error: `"${name}" adalah nama khusus Windows.` };
  if (name.toLowerCase().startsWith(TEMP_PREFIX)) return { ok: false, error: "Nama folder tidak valid." };
  if (name.length > MAX_NAME_CHARS || Buffer.byteLength(name, "utf8") > MAX_NAME_BYTES) {
    return { ok: false, error: "Nama folder terlalu panjang." };
  }
  return { ok: true, name };
}

/**
 * Splits a relative path from the browser (`Foto/2026`) into segments. Anything that could step
 * outside the root (`..`, `C:`, `\\server`, `file:stream`) makes the whole path invalid.
 */
export function splitRelativePath(input: string): string[] | null {
  const segments = input.split(/[\\/]+/).filter((segment) => segment.length > 0);
  if (segments.length > MAX_DEPTH) return null;
  for (const segment of segments) {
    if (segment === "." || segment === "..") return null;
    if (HAS_INVALID_CHARS.test(segment)) return null;
    if (/[. ]$/.test(segment)) return null;
    if (RESERVED_NAMES.test(segment)) return null;
  }
  return segments;
}

/** True if `child` is `parent` or somewhere inside it. Case-insensitive on Windows via path.relative. */
export function isWithin(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  if (relative === "") return true;
  if (path.isAbsolute(relative)) return false; // different drive on Windows
  return relative.split(path.sep)[0] !== "..";
}

/**
 * The single gatekeeper for every filesystem path built from browser input. Returns the canonical
 * path of an existing directory inside the root, or throws PathError.
 */
export async function resolveSafeDir(root: Root, relativePath: string): Promise<string> {
  const segments = splitRelativePath(relativePath);
  if (!segments) throw new PathError(400, "Path folder tidak valid.");

  const candidate = path.join(root.realPath, ...segments);
  if (!isWithin(root.realPath, candidate)) throw new PathError(403, "Akses ke folder ini ditolak.");

  let real: string;
  try {
    real = await fs.realpath(candidate);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") throw new PathError(404, "Folder tidak ditemukan.");
    throw new PathError(403, "Folder tidak bisa diakses.");
  }
  // A symlink or junction inside the root may point somewhere else entirely.
  if (!isWithin(root.realPath, real)) throw new PathError(403, "Akses ke folder ini ditolak.");

  const stat = await fs.stat(real);
  if (!stat.isDirectory()) throw new PathError(400, "Path tujuan bukan folder.");
  return real;
}

/**
 * Gatekeeper for reading one existing file inside a root (the gallery). Hidden files and
 * in-progress `.yshare-*.part` uploads are refused, because the folder listing never shows them.
 */
export async function resolveSafeFile(
  root: Root,
  relativePath: string,
  name: string,
): Promise<{ path: string; name: string; size: number; modified: number }> {
  const dir = await resolveSafeDir(root, relativePath);
  const segments = splitRelativePath(name);
  if (!segments || segments.length !== 1 || segments[0] !== name || name.startsWith(".")) {
    throw new PathError(400, "Nama file tidak valid.");
  }

  let real: string;
  try {
    real = await fs.realpath(path.join(dir, name));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") throw new PathError(404, "File tidak ditemukan.");
    throw new PathError(403, "File tidak bisa diakses.");
  }
  if (!isWithin(root.realPath, real)) throw new PathError(403, "Akses ke file ini ditolak.");

  const stat = await fs.stat(real);
  if (!stat.isFile()) throw new PathError(404, "File tidak ditemukan.");
  return { path: real, name, size: stat.size, modified: stat.mtimeMs };
}

/** `foto.jpg` → `foto (1).jpg`, `foto (2).jpg`, … */
export function numberedName(name: string, n: number): string {
  if (n === 0) return name;
  const ext = path.extname(name);
  const base = ext && ext !== name ? name.slice(0, -ext.length) : name;
  return `${base} (${n})${ext && ext !== name ? ext : ""}`;
}

export function hasBlockedExtension(name: string, blocked: string[]): boolean {
  const lower = name.toLowerCase();
  return blocked.some((ext) => lower.endsWith(ext));
}

/** Normalized relative path for display and for the client (`Foto/2026`). */
export function joinRelative(segments: string[]): string {
  return segments.join("/");
}
