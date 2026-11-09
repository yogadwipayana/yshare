// Helpers for sending stored files back to the browser (gallery, downloads).

/**
 * Next.js strips Content-Length from route handler responses and always streams them chunked.
 * Without it downloads show no size or progress and iOS Safari may refuse to play videos, so
 * /api/files sends the length in this header and server.ts turns it back into Content-Length.
 */
export const LENGTH_HEADER = "x-yshare-content-length";

export type ByteRange = { start: number; end: number };

/**
 * Parses a single `Range: bytes=…` header (videos need it for seeking, iOS Safari won't play
 * without it). Returns null to send the whole file (no header, multiple ranges, other units) and
 * "invalid" when the range is outside the file (416).
 */
export function parseRange(header: string | null, size: number): ByteRange | "invalid" | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, from, to] = match;

  if (from === "") {
    if (to === "") return null;
    const suffix = Number(to);
    if (suffix === 0 || size === 0) return "invalid";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(from);
  const end = to === "" ? size - 1 : Math.min(Number(to), size - 1);
  if (!Number.isSafeInteger(start) || start >= size || start > end) return "invalid";
  return { start, end };
}

/** Content-Disposition with an ASCII fallback plus the real (UTF-8) name, per RFC 6266. */
export function contentDisposition(type: "inline" | "attachment", name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]|["\\%;]/g, "_");
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/**
 * Changes whenever the file is replaced. The gallery puts it in the URL (`v=`), so the browser
 * can cache thumbnails and photos for good and still never show an old version.
 */
export function fileVersion(file: { size: number; modified: number }): string {
  return `${file.size.toString(36)}-${Math.trunc(file.modified).toString(36)}`;
}
