// Shared by the server (which Content-Type to send) and the browser (how to show a file).

export type MediaKind = "image" | "video" | "audio" | "other";

// Only formats a browser can show without running code. SVG and HTML are left out on purpose:
// they can contain scripts, so they are always downloaded instead of shown.
const TYPES: Record<string, [MediaKind, string]> = {
  ".jpg": ["image", "image/jpeg"],
  ".jpeg": ["image", "image/jpeg"],
  ".png": ["image", "image/png"],
  ".gif": ["image", "image/gif"],
  ".webp": ["image", "image/webp"],
  ".avif": ["image", "image/avif"],
  ".bmp": ["image", "image/bmp"],
  ".heic": ["image", "image/heic"],
  ".heif": ["image", "image/heif"],
  ".mp4": ["video", "video/mp4"],
  ".m4v": ["video", "video/mp4"],
  ".mov": ["video", "video/quicktime"],
  ".webm": ["video", "video/webm"],
  ".ogv": ["video", "video/ogg"],
  ".3gp": ["video", "video/3gpp"],
  ".mkv": ["video", "video/x-matroska"],
  ".mp3": ["audio", "audio/mpeg"],
  ".m4a": ["audio", "audio/mp4"],
  ".aac": ["audio", "audio/aac"],
  ".wav": ["audio", "audio/wav"],
  ".ogg": ["audio", "audio/ogg"],
  ".oga": ["audio", "audio/ogg"],
  ".opus": ["audio", "audio/ogg"],
  ".flac": ["audio", "audio/flac"],
  ".weba": ["audio", "audio/webm"],
};

// Formats the server can shrink into a thumbnail (decoders bundled with sharp).
const THUMBNAIL_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif"]);

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

export function mediaInfo(name: string): { kind: MediaKind; mime: string } {
  const entry = TYPES[extensionOf(name)];
  return entry ? { kind: entry[0], mime: entry[1] } : { kind: "other", mime: "application/octet-stream" };
}

export function canThumbnail(name: string): boolean {
  return THUMBNAIL_EXTENSIONS.has(extensionOf(name));
}
