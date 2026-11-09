import crypto from "node:crypto";
import type { Config, Root } from "./config";
import type { UploadSession } from "./upload";

export type Session = {
  id: string;
  createdAt: number;
  expiresAt: number;
  ip: string;
  userAgent: string;
};

export type ServerState = {
  config: Config;
  /** Secret inside the QR link. New on every start, so old links stop working after a restart. */
  token: string;
  pin: string;
  sessions: Map<string, Session>;
  /** Failed PIN attempts per IP (timestamps), for rate limiting. */
  pinFailures: Map<string, number[]>;
  pinFailuresGlobal: number[];
  /** Final paths that an in-progress upload has claimed, so two uploads never pick the same name. */
  reservedPaths: Set<string>;
  /** Temp files currently being written, cleaned up if the server stops mid-upload. */
  activeTemps: Set<string>;
  /** Unfinished resumable uploads by id. */
  uploads: Map<string, UploadSession>;
  startedAt: number;
};

// server.ts (run by tsx) and the route handlers (bundled by Next.js) load separate copies of this
// module, so the state has to live on globalThis to be shared.
const store = globalThis as typeof globalThis & { __yshare?: ServerState };

export function initState(config: Config): ServerState {
  const state: ServerState = {
    config,
    token: crypto.randomBytes(18).toString("base64url"),
    pin: crypto.randomInt(0, 1_000_000).toString().padStart(6, "0"),
    sessions: new Map(),
    pinFailures: new Map(),
    pinFailuresGlobal: [],
    reservedPaths: new Set(),
    activeTemps: new Set(),
    uploads: new Map(),
    startedAt: Date.now(),
  };
  store.__yshare = state;
  return state;
}

export function getState(): ServerState {
  const state = store.__yshare;
  if (!state) {
    throw new Error("yshare belum diinisialisasi. Jalankan lewat `npm run dev` atau `npm start`, bukan `next dev`.");
  }
  return state;
}

export function findRoot(id: string | null | undefined): Root | undefined {
  if (!id) return undefined;
  return getState().config.roots.find((root) => root.id === id);
}

/** Key for reservedPaths: Windows and macOS filesystems are case-insensitive by default. */
export function pathKey(absolutePath: string): string {
  return process.platform === "win32" || process.platform === "darwin"
    ? absolutePath.toLowerCase()
    : absolutePath;
}
