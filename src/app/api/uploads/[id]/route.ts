import { connection, type NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { logUpload } from "@/lib/log";
import type { PatchUploadResponse } from "@/lib/types";
import {
  appendToSession,
  discardSession,
  finalizeSession,
  findSession,
  OffsetMismatch,
  stopActive,
  UploadError,
} from "@/lib/upload";

type Context = { params: Promise<{ id: string }> };

const NOT_FOUND = "Upload ini sudah tidak ada di server (mungkin server di-restart). Mulai ulang upload-nya.";

/** GET /api/uploads/{id} — how many bytes the server already has. */
export async function GET(request: NextRequest, { params }: Context) {
  await connection();
  const denied = requireSession(request);
  if (denied) return denied;

  const session = findSession((await params).id);
  if (!session) return apiError(404, NOT_FOUND);
  // The browser only asks after its connection broke; end the stale request so the offset is final.
  await stopActive(session);
  return Response.json({ offset: session.offset, size: session.size });
}

/**
 * PATCH /api/uploads/{id}
 * Headers: Upload-Offset (where this body starts), Content-Length.
 * Body: raw bytes of the file from Upload-Offset onwards.
 */
export async function PATCH(request: NextRequest, { params }: Context) {
  const denied = requireSession(request);
  if (denied) return denied;

  const session = findSession((await params).id);
  if (!session) return apiError(404, NOT_FOUND);

  const offset = Number(request.headers.get("upload-offset"));
  const lengthHeader = request.headers.get("content-length");
  const length = Number(lengthHeader);
  if (!Number.isSafeInteger(offset) || offset < 0) return apiError(400, "Header Upload-Offset tidak valid.");
  if (lengthHeader === null || !Number.isSafeInteger(length) || length < 0) {
    return apiError(411, "Header Content-Length wajib ada.");
  }

  try {
    await appendToSession(session, request.body, offset, length, request.signal);
  } catch (err) {
    if (err instanceof OffsetMismatch) {
      return Response.json({ error: "Offset tidak cocok.", offset: err.offset }, { status: 409 });
    }
    if (err instanceof UploadError) return apiError(err.status, err.message);
    if ((err as NodeJS.ErrnoException).code === "ENOSPC") {
      await discardSession(session, "failed", "Disk penuh");
      return apiError(507, "Ruang disk server penuh.");
    }
    // Connection dropped (screen locked, Wi-Fi gone). The bytes that arrived are kept.
    logUpload({
      ip: session.ip,
      root: session.rootName,
      path: session.relPath,
      name: session.claim.name,
      size: session.size,
      status: "interrupted",
      ms: Date.now() - session.createdAt,
      error: `di ${Math.floor((session.offset / Math.max(session.size, 1)) * 100)}%, bisa dilanjutkan`,
    });
    return Response.json({ error: "Koneksi terputus.", offset: session.offset }, { status: 408 });
  }

  if (session.offset < session.size) {
    const partial: PatchUploadResponse = { status: "partial", offset: session.offset };
    return Response.json(partial);
  }

  try {
    const result = await finalizeSession(session);
    const saved: PatchUploadResponse = {
      status: "saved",
      name: result.name,
      size: result.size,
      renamed: result.name !== session.originalName,
    };
    return Response.json(saved);
  } catch (err) {
    if (err instanceof UploadError) return apiError(err.status, err.message);
    console.error(err);
    return apiError(500, "Gagal menyimpan file.");
  }
}

/** DELETE /api/uploads/{id} — cancel and delete the partial file. */
export async function DELETE(request: NextRequest, { params }: Context) {
  const denied = requireSession(request);
  if (denied) return denied;

  const session = findSession((await params).id);
  if (session) await discardSession(session, "aborted");
  return Response.json({ ok: true });
}
