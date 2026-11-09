import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import type { ConflictPolicy } from "@/lib/config";
import { formatBytes } from "@/lib/format";
import { apiError, clientIp, pathErrorResponse, readJson } from "@/lib/http";
import { logUpload } from "@/lib/log";
import { hasBlockedExtension, joinRelative, resolveSafeDir, sanitizeFileName, splitRelativePath } from "@/lib/paths";
import { findRoot, getState } from "@/lib/state";
import type { CreateUploadResponse } from "@/lib/types";
import {
  createSession,
  findSessionByFingerprint,
  hasRoomFor,
  stopActive,
  UploadError,
} from "@/lib/upload";

const POLICIES = new Set<ConflictPolicy>(["rename", "overwrite", "skip"]);

type Body = {
  root?: string;
  path?: string;
  name?: string;
  size?: number;
  lastModified?: number;
  conflict?: string;
};

/**
 * POST /api/uploads — start (or resume) an upload. No file data yet; the bytes follow with
 * PATCH /api/uploads/{id}. Picking the same file for the same folder again returns the existing
 * upload and its offset, so it continues instead of starting over.
 */
export async function POST(request: NextRequest) {
  const denied = requireSession(request);
  if (denied) return denied;

  const { config } = getState();
  const body = await readJson<Body>(request);
  if (!body || typeof body.name !== "string") return apiError(400, "Permintaan tidak valid.");

  const root = findRoot(body.root);
  if (!root) return apiError(404, "Root folder tidak ditemukan.");
  const segments = splitRelativePath(body.path ?? "");
  if (!segments) return apiError(400, "Path folder tidak valid.");
  const relPath = joinRelative(segments);

  let dir: string;
  try {
    dir = await resolveSafeDir(root, relPath);
  } catch (err) {
    return pathErrorResponse(err);
  }

  const name = sanitizeFileName(body.name);
  if (!name) return apiError(400, "Nama file tidak valid.");
  if (hasBlockedExtension(name, config.upload.blockedExtensions)) {
    return apiError(415, "Jenis file ini diblokir oleh konfigurasi server.");
  }

  const size = body.size;
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) {
    return apiError(400, "Ukuran file tidak valid.");
  }
  if (size > config.upload.maxFileSize) {
    return apiError(413, `File terlalu besar. Maksimal ${formatBytes(config.upload.maxFileSize)}.`);
  }
  const policy = POLICIES.has(body.conflict as ConflictPolicy)
    ? (body.conflict as ConflictPolicy)
    : config.upload.conflictDefault;

  const fingerprint = [root.id, relPath, name, size, body.lastModified ?? ""].join("\u0000");
  const existing = findSessionByFingerprint(fingerprint);
  if (existing) {
    await stopActive(existing);
    const response: CreateUploadResponse = { status: "resume", id: existing.id, offset: existing.offset };
    return Response.json(response);
  }

  if (!(await hasRoomFor(dir, size))) {
    return apiError(507, "Ruang disk server tidak cukup untuk file ini.");
  }

  const ip = clientIp(request);
  let session;
  try {
    session = await createSession({
      fingerprint,
      rootName: root.name,
      relPath,
      dir,
      name,
      originalName: body.name,
      size,
      policy,
      ip,
    });
  } catch (err) {
    if (err instanceof UploadError) return apiError(err.status, err.message);
    console.error(err);
    return apiError(500, "Upload tidak bisa dimulai.");
  }

  if (!session) {
    logUpload({ ip, root: root.name, path: relPath, name, size, status: "skipped", ms: 0 });
    const response: CreateUploadResponse = { status: "skipped", name };
    return Response.json(response);
  }

  const response: CreateUploadResponse = { status: "created", id: session.id, offset: 0 };
  return Response.json(response, { status: 201 });
}
