import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { ConflictPolicy } from "./config";
import { logUpload } from "./log";
import { numberedName, TEMP_PREFIX, TEMP_SUFFIX } from "./paths";
import { getState, pathKey } from "./state";
import { registerTemp, unregisterTemp } from "./temp";

/** Free bytes kept in reserve so an upload never fills the disk completely. */
const DISK_SAFETY_MARGIN = 256 * 1024 * 1024;
/** No bytes for this long means the phone is gone (screen locked, Wi-Fi dropped). */
const IDLE_TIMEOUT_MS = 60_000;
/** Unfinished uploads are kept this long after their last activity, so they can be resumed. */
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export class UploadError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function exists(file: string): Promise<boolean> {
  try {
    await fsp.lstat(file);
    return true;
  } catch {
    return false;
  }
}

export async function freeSpace(dir: string): Promise<{ free: number; total: number } | null> {
  try {
    const stats = await fsp.statfs(dir);
    return { free: stats.bavail * stats.bsize, total: stats.blocks * stats.bsize };
  } catch {
    return null;
  }
}

export async function hasRoomFor(dir: string, size: number): Promise<boolean> {
  const space = await freeSpace(dir);
  return space === null || size + DISK_SAFETY_MARGIN <= space.free;
}

export type Claim = { name: string; finalPath: string; release: () => void };

/**
 * Picks the final file name according to the conflict policy and reserves it, so that two
 * uploads running at the same time never end up with the same name.
 * Returns null when the policy is "skip" and the name is taken.
 */
export async function claimTarget(dir: string, name: string, policy: ConflictPolicy): Promise<Claim | null> {
  const { reservedPaths } = getState();
  const reserve = (candidate: string): Claim => {
    const finalPath = path.join(dir, candidate);
    const key = pathKey(finalPath);
    reservedPaths.add(key);
    return { name: candidate, finalPath, release: () => reservedPaths.delete(key) };
  };
  const isReserved = (candidate: string) => reservedPaths.has(pathKey(path.join(dir, candidate)));

  if (policy === "overwrite") {
    if (isReserved(name)) throw new UploadError(409, "File dengan nama ini sedang diupload.");
    return reserve(name);
  }

  if (policy === "skip") {
    if (isReserved(name) || (await exists(path.join(dir, name)))) return null;
    // Re-check after the await: another request may have reserved it in the meantime.
    if (isReserved(name)) return null;
    return reserve(name);
  }

  for (let n = 0; n < 10_000; n++) {
    const candidate = numberedName(name, n);
    if (isReserved(candidate)) continue;
    if (await exists(path.join(dir, candidate))) continue;
    if (isReserved(candidate)) continue;
    return reserve(candidate);
  }
  throw new UploadError(409, "Terlalu banyak file dengan nama yang sama.");
}

// ---------------------------------------------------------------------------------------------
// Resumable uploads
//
// 1. POST   /api/uploads        → creates a session and an empty `.part` file next to the target.
// 2. PATCH  /api/uploads/{id}   → appends bytes at `Upload-Offset`. Whatever arrives is kept,
//                                 even if the connection drops halfway.
// 3. GET    /api/uploads/{id}   → current offset, so the browser knows where to continue.
// 4. When offset == size the `.part` file is renamed to its final name.
// ---------------------------------------------------------------------------------------------

export type UploadSession = {
  id: string;
  /** Same file to the same folder → same fingerprint, so re-picking a file resumes it. */
  fingerprint: string;
  rootName: string;
  relPath: string;
  dir: string;
  originalName: string;
  size: number;
  policy: ConflictPolicy;
  claim: Claim;
  temp: string;
  /** Bytes safely written to the `.part` file. */
  offset: number;
  createdAt: number;
  updatedAt: number;
  ip: string;
  /** The PATCH request currently writing, if any. */
  active?: { controller: AbortController; done: Promise<void> };
};

export function findSession(id: string): UploadSession | undefined {
  return getState().uploads.get(id);
}

export function findSessionByFingerprint(fingerprint: string): UploadSession | undefined {
  for (const session of getState().uploads.values()) {
    if (session.fingerprint === fingerprint) return session;
  }
  return undefined;
}

export async function createSession(options: {
  fingerprint: string;
  rootName: string;
  relPath: string;
  dir: string;
  name: string;
  originalName: string;
  size: number;
  policy: ConflictPolicy;
  ip: string;
}): Promise<UploadSession | null> {
  const claim = await claimTarget(options.dir, options.name, options.policy);
  if (!claim) return null;

  const temp = path.join(options.dir, `${TEMP_PREFIX}${crypto.randomUUID()}${TEMP_SUFFIX}`);
  try {
    await fsp.writeFile(temp, "", { flag: "wx" });
  } catch (err) {
    claim.release();
    throw err;
  }
  registerTemp(temp);

  const now = Date.now();
  const session: UploadSession = {
    id: crypto.randomUUID(),
    fingerprint: options.fingerprint,
    rootName: options.rootName,
    relPath: options.relPath,
    dir: options.dir,
    originalName: options.originalName,
    size: options.size,
    policy: options.policy,
    claim,
    temp,
    offset: 0,
    createdAt: now,
    updatedAt: now,
    ip: options.ip,
  };
  getState().uploads.set(session.id, session);
  return session;
}

/**
 * A phone that locked its screen often never closes its connection, so the old PATCH would hang
 * forever. When the phone comes back, end the old request first so the offset is final.
 */
export async function stopActive(session: UploadSession): Promise<void> {
  if (!session.active) return;
  session.active.controller.abort();
  await session.active.done;
}

export class OffsetMismatch extends Error {
  constructor(public offset: number) {
    super("Offset tidak cocok");
  }
}

/** Appends a request body at `offset`. Keeps every byte that arrived, even if the stream fails. */
export async function appendToSession(
  session: UploadSession,
  body: ReadableStream<Uint8Array> | null,
  offset: number,
  length: number,
  requestSignal: AbortSignal,
): Promise<void> {
  await stopActive(session);
  if (offset !== session.offset) throw new OffsetMismatch(session.offset);
  if (offset + length > session.size) throw new UploadError(400, "Data melebihi ukuran file.");
  if (length === 0) return;

  const controller = new AbortController();
  let markDone!: () => void;
  session.active = { controller, done: new Promise<void>((resolve) => (markDone = resolve)) };

  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const resetIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
  };
  let received = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      resetIdle();
      if (received > length) callback(new UploadError(400, "Data melebihi ukuran yang dikirim."));
      else callback(null, chunk);
    },
  });
  const out = fs.createWriteStream(session.temp, { flags: "r+", start: offset });

  try {
    resetIdle();
    const source = body ? Readable.fromWeb(body as unknown as NodeReadableStream) : Readable.from([]);
    await pipeline(source, counter, out, { signal: AbortSignal.any([requestSignal, controller.signal]) });
  } finally {
    clearTimeout(idleTimer);
    // The file may still be closing after an error; wait so the size on disk is final.
    if (!out.closed) await new Promise<void>((resolve) => out.once("close", () => resolve()));
    const stat = await fsp.stat(session.temp).catch(() => null);
    session.offset = stat ? Math.min(stat.size, session.size) : offset;
    session.updatedAt = Date.now();
    session.active = undefined;
    markDone();
  }
}

/** Renames the finished `.part` file to its final name. */
export async function finalizeSession(session: UploadSession): Promise<{ name: string; size: number }> {
  let claim = session.claim;
  // Something outside yshare may have created a file with this name during the upload.
  if (session.policy === "rename" && (await exists(claim.finalPath))) {
    const fresh = await claimTarget(session.dir, claim.name, "rename");
    claim.release();
    claim = fresh!; // "rename" always finds a name or throws
    session.claim = claim;
  }
  if (session.policy === "skip" && (await exists(claim.finalPath))) {
    await discardSession(session, "skipped");
    throw new UploadError(409, "File dengan nama ini sudah ada.");
  }

  try {
    await fsp.rename(session.temp, claim.finalPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // The session stays, so the user can close the other program and press retry.
    if (code === "EPERM" || code === "EBUSY" || code === "EACCES") {
      throw new UploadError(423, "File tujuan sedang dibuka program lain. Tutup programnya lalu coba lagi.");
    }
    if (code === "EISDIR") throw new UploadError(409, "Sudah ada folder dengan nama ini.");
    throw err;
  }

  unregisterTemp(session.temp);
  claim.release();
  getState().uploads.delete(session.id);
  logUpload({
    ip: session.ip,
    root: session.rootName,
    path: session.relPath,
    name: claim.name,
    size: session.size,
    status: "saved",
    ms: Date.now() - session.createdAt,
  });
  return { name: claim.name, size: session.size };
}

/** Cancels an upload and deletes its `.part` file. */
export async function discardSession(
  session: UploadSession,
  status: "aborted" | "skipped" | "failed",
  error?: string,
): Promise<void> {
  getState().uploads.delete(session.id);
  await stopActive(session);
  await fsp.rm(session.temp, { force: true }).catch(() => {});
  unregisterTemp(session.temp);
  session.claim.release();
  logUpload({
    ip: session.ip,
    root: session.rootName,
    path: session.relPath,
    name: session.claim.name,
    size: session.size,
    status,
    ms: Date.now() - session.createdAt,
    error,
  });
}

/** Deletes uploads nobody has touched for SESSION_TTL_MS. Called periodically by server.ts. */
export async function cleanupStaleSessions(): Promise<void> {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const session of [...getState().uploads.values()]) {
    if (!session.active && session.updatedAt < cutoff) {
      await discardSession(session, "aborted", "Tidak dilanjutkan selama 24 jam");
    }
  }
}
