import fs from "node:fs";
import { Readable } from "node:stream";
import { connection, type NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { apiError, pathErrorResponse } from "@/lib/http";
import { canThumbnail, mediaInfo } from "@/lib/media";
import { resolveSafeFile } from "@/lib/paths";
import { contentDisposition, fileVersion, LENGTH_HEADER, parseRange } from "@/lib/serve";
import { findRoot } from "@/lib/state";
import { getThumbnail } from "@/lib/thumbnail";

// Stored files are whatever visitors uploaded. If one is ever opened directly as a page, it runs
// in a sandbox: no scripts, no cookies, no access to yshare.
const SANDBOX = "sandbox; default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'";

/**
 * GET /api/files?root=…&path=…&name=…[&v=…][&thumb=1][&dl=1]
 * One stored file, for the gallery. Photos, videos and audio are shown in the browser; every
 * other type (and any file with `dl=1`) is sent as a download and never rendered.
 */
export async function GET(request: NextRequest) {
  return serve(request, true);
}

export async function HEAD(request: NextRequest) {
  return serve(request, false);
}

async function serve(request: NextRequest, withBody: boolean): Promise<Response> {
  await connection();
  const denied = requireSession(request);
  if (denied) return denied;

  const params = request.nextUrl.searchParams;
  const root = findRoot(params.get("root"));
  if (!root) return apiError(404, "Root folder tidak ditemukan.");

  let file;
  try {
    file = await resolveSafeFile(root, params.get("path") ?? "", params.get("name") ?? "");
  } catch (err) {
    return pathErrorResponse(err);
  }

  const { kind, mime } = mediaInfo(file.name);
  const inline = kind !== "other" && params.get("dl") !== "1";
  const version = fileVersion(file);
  const headers = new Headers({
    "Content-Security-Policy": SANDBOX,
    "X-Content-Type-Options": "nosniff",
    // With a matching `v`, this URL can only ever mean this exact content.
    "Cache-Control": params.get("v") === version ? "private, max-age=31536000, immutable" : "private, no-cache",
    "Last-Modified": new Date(file.modified).toUTCString(),
  });

  if (params.get("thumb") === "1" && kind === "image" && canThumbnail(file.name)) {
    const thumb = await getThumbnail(file.path, version);
    if (thumb) {
      const etag = `"t-${version}"`;
      headers.set("ETag", etag);
      headers.set("Content-Type", "image/webp");
      headers.set("Content-Disposition", contentDisposition("inline", file.name.replace(/\.[^.]*$/, ".webp")));
      if (isNotModified(request, etag, file.modified)) return new Response(null, { status: 304, headers });
      headers.set(LENGTH_HEADER, String(thumb.length));
      return new Response(withBody ? new Uint8Array(thumb) : null, { headers });
    }
    // No thumbnail possible: send the original instead.
  }

  const etag = `"${version}"`;
  headers.set("ETag", etag);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Content-Type", inline ? mime : "application/octet-stream");
  headers.set("Content-Disposition", contentDisposition(inline ? "inline" : "attachment", file.name));
  if (isNotModified(request, etag, file.modified)) return new Response(null, { status: 304, headers });

  // If-Range: only send a part when the browser's partial copy is still the current file.
  const ifRange = request.headers.get("if-range");
  const range = ifRange && ifRange !== etag ? null : parseRange(request.headers.get("range"), file.size);
  if (range === "invalid") {
    headers.set("Content-Range", `bytes */${file.size}`);
    return new Response(null, { status: 416, headers });
  }

  const start = range?.start ?? 0;
  const end = range?.end ?? file.size - 1;
  const status = range ? 206 : 200;
  headers.set(LENGTH_HEADER, String(file.size === 0 ? 0 : end - start + 1));
  if (range) headers.set("Content-Range", `bytes ${start}-${end}/${file.size}`);

  if (!withBody || file.size === 0) return new Response(null, { status, headers });
  // Streamed from disk, so RAM stays flat even for large videos.
  const stream = Readable.toWeb(fs.createReadStream(file.path, { start, end })) as ReadableStream<Uint8Array>;
  return new Response(stream, { status, headers });
}

function isNotModified(request: NextRequest, etag: string, modified: number): boolean {
  const ifNoneMatch = request.headers.get("if-none-match");
  if (ifNoneMatch) return ifNoneMatch.split(",").some((tag) => tag.trim().replace(/^W\//, "") === etag);
  const since = Date.parse(request.headers.get("if-modified-since") ?? "");
  return Number.isFinite(since) && Math.floor(modified / 1000) * 1000 <= since;
}
