import fsp from "node:fs/promises";
import path from "node:path";
import { connection, type NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { apiError, pathErrorResponse, readJson } from "@/lib/http";
import {
  isWithin,
  joinRelative,
  resolveSafeDir,
  splitRelativePath,
  TEMP_PREFIX,
  validateFolderName,
} from "@/lib/paths";
import { findRoot } from "@/lib/state";
import { freeSpace } from "@/lib/upload";

const MAX_FILES_STAT = 2000;
const MAX_FILES_RETURNED = 200;
const HIDDEN_SYSTEM = new Set(["$recycle.bin", "system volume information"]);

function isHidden(name: string): boolean {
  return name.startsWith(".") || HIDDEN_SYSTEM.has(name.toLowerCase());
}

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, "id", { numeric: true, sensitivity: "base" });

/**
 * GET /api/folders?root=…&path=…[&limit=…] — subfolders and newest files of a folder inside a
 * root. `limit` is how many files to return (0–2000, default 200); 0 skips reading file details.
 */
export async function GET(request: NextRequest) {
  await connection();
  const denied = requireSession(request);
  if (denied) return denied;

  const params = request.nextUrl.searchParams;
  const limitParam = Number(params.get("limit") ?? MAX_FILES_RETURNED);
  const limit = Number.isInteger(limitParam) ? Math.min(Math.max(limitParam, 0), MAX_FILES_STAT) : MAX_FILES_RETURNED;
  const root = findRoot(params.get("root"));
  if (!root) return apiError(404, "Root folder tidak ditemukan.");

  const segments = splitRelativePath(params.get("path") ?? "");
  let dir: string;
  try {
    if (!segments) return apiError(400, "Path folder tidak valid.");
    dir = await resolveSafeDir(root, joinRelative(segments));
  } catch (err) {
    return pathErrorResponse(err);
  }

  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return apiError(403, "Isi folder tidak bisa dibaca.");
  }

  const folders: { name: string }[] = [];
  const fileNames: string[] = [];
  await Promise.all(
    entries.map(async (entry) => {
      if (isHidden(entry.name) || entry.name.startsWith(TEMP_PREFIX)) return;
      if (entry.isDirectory()) {
        folders.push({ name: entry.name });
      } else if (entry.isSymbolicLink()) {
        // Only show links (and Windows junctions) that stay inside the root.
        try {
          const real = await fsp.realpath(path.join(dir, entry.name));
          if (isWithin(root.realPath, real) && (await fsp.stat(real)).isDirectory()) {
            folders.push({ name: entry.name });
          }
        } catch {
          // Broken link.
        }
      } else if (entry.isFile()) {
        fileNames.push(entry.name);
      }
    }),
  );
  folders.sort(byName);

  const files: { name: string; size: number; modified: number }[] = [];
  await Promise.all(
    fileNames.slice(0, limit === 0 ? 0 : MAX_FILES_STAT).map(async (name) => {
      try {
        const stat = await fsp.stat(path.join(dir, name));
        files.push({ name, size: stat.size, modified: stat.mtimeMs });
      } catch {
        // Removed or locked between readdir and stat.
      }
    }),
  );
  files.sort((a, b) => b.modified - a.modified);

  return Response.json({
    root: { id: root.id, name: root.name },
    path: joinRelative(segments),
    segments,
    folders,
    files: files.slice(0, limit),
    fileCount: fileNames.length,
    space: await freeSpace(dir),
  });
}

type CreateBody = { root?: string; path?: string; name?: string };

/** POST /api/folders { root, path, name } — create a folder inside `path`. */
export async function POST(request: NextRequest) {
  const denied = requireSession(request);
  if (denied) return denied;

  const body = await readJson<CreateBody>(request);
  if (!body || typeof body.name !== "string") return apiError(400, "Permintaan tidak valid.");

  const root = findRoot(body.root);
  if (!root) return apiError(404, "Root folder tidak ditemukan.");

  const check = validateFolderName(body.name);
  if (!check.ok) return apiError(400, check.error);

  let parent: string;
  try {
    parent = await resolveSafeDir(root, body.path ?? "");
  } catch (err) {
    return pathErrorResponse(err);
  }

  try {
    await fsp.mkdir(path.join(parent, check.name));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EEXIST") return apiError(409, "Folder dengan nama itu sudah ada.");
    console.error(err);
    return apiError(500, "Folder gagal dibuat.");
  }

  const segments = [...(splitRelativePath(body.path ?? "") ?? []), check.name];
  return Response.json({ name: check.name, path: joinRelative(segments) }, { status: 201 });
}
