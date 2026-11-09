import type { ConflictPolicy, CreateUploadResponse, PatchUploadResponse } from "../types";

export type Destination = { root: string; path: string; label: string };

export type ItemStatus = "queued" | "uploading" | "paused" | "done" | "skipped" | "failed" | "canceled";

export type QueueItem = {
  id: string;
  file: File;
  dest: Destination;
  policy: ConflictPolicy;
  status: ItemStatus;
  /** Bytes sent so far (confirmed offset + progress of the current request). */
  loaded: number;
  /** Bytes per second, smoothed. */
  speed: number;
  /** Server-side upload id, once created. */
  uploadId?: string;
  /** Number of reconnect attempts since the last successful progress. */
  attempts: number;
  savedAs?: string;
  renamed?: boolean;
  error?: string;
};

export type PreResult = { status: "skipped" | "failed"; error?: string };

type Hooks = {
  onFinished?: (item: QueueItem) => void;
  onUnauthorized?: () => void;
};

const PROGRESS_INTERVAL_MS = 200;
/** No upload progress for this long → treat the connection as dead and reconnect. */
const STALL_TIMEOUT_MS = 30_000;
const RETRY_DELAYS_S = [1, 2, 4, 8, 15, 30];
const MAX_ATTEMPTS_WITHOUT_PROGRESS = 40;

/** Retry (connection problem) vs. give up (server said no). */
class TransferError extends Error {
  constructor(
    message: string,
    public retryable: boolean,
    public kind: "network" | "lost" | "unauthorized" | "server" = "server",
  ) {
    super(message);
  }
}

let counter = 0;
const nextId = () => `u${Date.now().toString(36)}${(counter++).toString(36)}`;

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Upload queue that lives outside React. Components read it through useSyncExternalStore.
 *
 * Each file is uploaded in a resumable way: the server keeps every byte it received, so when the
 * phone locks its screen or the Wi-Fi drops, the upload pauses and later continues from where it
 * stopped instead of starting over.
 */
export class UploadQueue {
  private items: QueueItem[] = [];
  private listeners = new Set<() => void>();
  private hooks: Hooks = {};
  private xhrs = new Map<string, XMLHttpRequest>();
  private fetches = new Map<string, AbortController>();
  private retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private canceled = new Set<string>();

  constructor(private parallel: number) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.items;

  setHooks(hooks: Hooks) {
    this.hooks = hooks;
  }

  /** Resume paused uploads as soon as the page is visible or the network is back. */
  attach(): () => void {
    const wake = () => {
      if (document.visibilityState === "visible") this.resumeAll();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    window.addEventListener("pageshow", wake);
    return () => {
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      window.removeEventListener("pageshow", wake);
    };
  }

  hasActive() {
    return this.items.some((i) => i.status === "queued" || i.status === "uploading" || i.status === "paused");
  }

  add(files: File[], dest: Destination, policy: ConflictPolicy, pre: Map<File, PreResult>) {
    const added = files.map<QueueItem>((file) => {
      const preset = pre.get(file);
      return {
        id: nextId(),
        file,
        dest,
        policy,
        status: preset?.status ?? "queued",
        error: preset?.error,
        loaded: 0,
        speed: 0,
        attempts: 0,
      };
    });
    this.items = [...this.items, ...added];
    this.emit();
    this.pump();
  }

  cancel(id: string) {
    const item = this.get(id);
    if (!item || !["queued", "uploading", "paused"].includes(item.status)) return;
    this.canceled.add(id);
    this.clearRetry(id);
    this.xhrs.get(id)?.abort();
    this.fetches.get(id)?.abort();
    if (item.uploadId) {
      void fetch(`/api/uploads/${item.uploadId}`, { method: "DELETE" }).catch(() => {});
    }
    this.update(id, { status: "canceled", uploadId: undefined, speed: 0 });
    this.pump();
  }

  cancelAll() {
    for (const item of this.items) this.cancel(item.id);
  }

  /** Retry a failed/canceled upload, or reconnect a paused one right now. */
  retry(id: string) {
    const item = this.get(id);
    if (!item) return;
    if (item.status === "paused") {
      this.clearRetry(id);
      void this.run(id);
      return;
    }
    if (item.status !== "failed" && item.status !== "canceled") return;
    this.canceled.delete(id);
    this.update(id, { status: "queued", error: undefined, speed: 0, attempts: 0 });
    this.pump();
  }

  clearFinished() {
    this.items = this.items.filter((i) => i.status === "queued" || i.status === "uploading" || i.status === "paused");
    this.emit();
  }

  private resumeAll() {
    for (const item of this.items) {
      if (item.status === "paused") {
        this.clearRetry(item.id);
        void this.run(item.id);
      }
    }
  }

  private get(id: string) {
    return this.items.find((i) => i.id === id);
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }

  private update(id: string, patch: Partial<QueueItem>) {
    this.items = this.items.map((item) => (item.id === id ? { ...item, ...patch } : item));
    this.emit();
  }

  private clearRetry(id: string) {
    clearTimeout(this.retryTimers.get(id));
    this.retryTimers.delete(id);
  }

  private pump() {
    // Paused uploads keep their slot: they're still in progress, just waiting for the connection.
    let active = this.items.filter((i) => i.status === "uploading" || i.status === "paused").length;
    for (const item of this.items) {
      if (active >= this.parallel) break;
      if (item.status !== "queued") continue;
      active++;
      this.canceled.delete(item.id);
      void this.run(item.id);
    }
  }

  private finish(id: string, patch: Partial<QueueItem>) {
    this.clearRetry(id);
    this.update(id, { ...patch, speed: 0 });
    const item = this.get(id);
    if (item) this.hooks.onFinished?.(item);
    this.pump();
  }

  private async run(id: string) {
    let item = this.get(id);
    if (!item || this.canceled.has(id) || item.status === "uploading") return;
    this.update(id, { status: "uploading", error: undefined });

    try {
      for (;;) {
        item = this.get(id)!;
        if (this.canceled.has(id)) return;

        let offset: number;
        if (!item.uploadId) {
          const created = await this.create(item);
          if (created.status === "skipped") {
            this.finish(id, { status: "skipped", loaded: item.file.size });
            return;
          }
          if (this.canceled.has(id)) {
            // Canceled while the server was creating it: clean up the server side too.
            void fetch(`/api/uploads/${created.id}`, { method: "DELETE" }).catch(() => {});
            return;
          }
          this.update(id, { uploadId: created.id });
          offset = created.offset;
        } else {
          const known = await this.fetchOffset(item);
          if (known === null) {
            // Server lost the upload (restarted). Start again from zero.
            this.update(id, { uploadId: undefined, loaded: 0 });
            continue;
          }
          offset = known;
        }

        if (offset > item.loaded) this.update(id, { attempts: 0 }); // the server got more data: progress
        this.update(id, { loaded: offset });

        const result = await this.send(id, offset);
        if (result.status === "saved") {
          this.finish(id, {
            status: "done",
            loaded: item.file.size,
            uploadId: undefined,
            savedAs: result.name,
            renamed: result.renamed,
          });
          return;
        }
        // "partial": loop and continue from the new offset.
      }
    } catch (err) {
      if (this.canceled.has(id)) return;
      const error = err instanceof TransferError ? err : new TransferError("Terjadi kesalahan.", true, "network");
      if (error.kind === "lost") {
        // Server restarted and forgot this upload: start it again from zero.
        this.update(id, { uploadId: undefined, loaded: 0 });
      }
      if (error.kind === "unauthorized") {
        this.finish(id, { status: "failed", error: "Sesi habis. Masuk lagi lalu tekan coba lagi." });
        this.hooks.onUnauthorized?.();
        return;
      }
      const current = this.get(id)!;
      if (!error.retryable || current.attempts >= MAX_ATTEMPTS_WITHOUT_PROGRESS) {
        this.finish(id, { status: "failed", error: error.message });
        return;
      }
      this.pause(id, error.message);
    }
  }

  private pause(id: string, reason: string) {
    const item = this.get(id)!;
    const attempts = item.attempts + 1;
    this.update(id, { status: "paused", error: reason, attempts, speed: 0 });
    // While the screen is off, timers barely run anyway; "visibilitychange" resumes immediately.
    const delay = RETRY_DELAYS_S[Math.min(attempts - 1, RETRY_DELAYS_S.length - 1)] * 1000;
    this.retryTimers.set(
      id,
      setTimeout(() => {
        this.retryTimers.delete(id);
        if (document.visibilityState === "visible") void this.run(id);
      }, delay),
    );
  }

  private async request(id: string, url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    this.fetches.set(id, controller);
    const timeout = setTimeout(() => controller.abort(), STALL_TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
    } catch {
      throw new TransferError("Koneksi ke server terputus.", true, "network");
    } finally {
      clearTimeout(timeout);
      this.fetches.delete(id);
    }
  }

  private async create(item: QueueItem): Promise<CreateUploadResponse> {
    const res = await this.request(item.id, "/api/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        root: item.dest.root,
        path: item.dest.path,
        name: item.file.name,
        size: item.file.size,
        lastModified: item.file.lastModified,
        conflict: item.policy,
      }),
    });
    const body = await readJson(res);
    if (res.status === 401) throw new TransferError("Sesi habis.", false, "unauthorized");
    if (!res.ok) {
      throw new TransferError(String(body.error ?? `Gagal (kode ${res.status})`), res.status >= 500);
    }
    return body as CreateUploadResponse;
  }

  /** Returns the server's offset, or null if the server no longer knows this upload. */
  private async fetchOffset(item: QueueItem): Promise<number | null> {
    const res = await this.request(item.id, `/api/uploads/${item.uploadId}`, { method: "GET" });
    if (res.status === 404) return null;
    if (res.status === 401) throw new TransferError("Sesi habis.", false, "unauthorized");
    const body = await readJson(res);
    if (!res.ok) throw new TransferError(String(body.error ?? `Gagal (kode ${res.status})`), res.status >= 500);
    return Number(body.offset);
  }

  /** Sends the rest of the file from `offset` with XHR (fetch can't report upload progress). */
  private send(id: string, offset: number): Promise<PatchUploadResponse> {
    const item = this.get(id)!;
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      this.xhrs.set(id, xhr);
      xhr.open("PATCH", `/api/uploads/${item.uploadId}`);
      xhr.setRequestHeader("Content-Type", "application/octet-stream");
      xhr.setRequestHeader("Upload-Offset", String(offset));

      let stalled = false;
      let stallTimer: ReturnType<typeof setTimeout> | undefined;
      const armStall = () => {
        clearTimeout(stallTimer);
        stallTimer = setTimeout(() => {
          stalled = true;
          xhr.abort();
        }, STALL_TIMEOUT_MS);
      };
      armStall();

      let lastTime = performance.now();
      let lastLoaded = 0;
      let speed = 0;
      let progressed = false;
      xhr.upload.onprogress = (event) => {
        armStall();
        const now = performance.now();
        const elapsed = now - lastTime;
        if (elapsed < PROGRESS_INTERVAL_MS && event.loaded < event.total) return;
        const instant = ((event.loaded - lastLoaded) / Math.max(elapsed, 1)) * 1000;
        speed = speed === 0 ? instant : speed * 0.7 + instant * 0.3;
        lastTime = now;
        lastLoaded = event.loaded;
        const patch: Partial<QueueItem> = { loaded: offset + event.loaded, speed };
        if (!progressed && event.loaded > 0) {
          progressed = true;
          patch.attempts = 0;
        }
        this.update(id, patch);
      };

      const done = () => {
        clearTimeout(stallTimer);
        this.xhrs.delete(id);
      };

      xhr.onload = () => {
        done();
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(xhr.responseText);
        } catch {
          // Non-JSON error page.
        }
        if (xhr.status === 200) return resolve(body as PatchUploadResponse);
        if (xhr.status === 401) return reject(new TransferError("Sesi habis.", false, "unauthorized"));
        if (xhr.status === 404) return reject(new TransferError("Server kehilangan upload ini, mengulang dari awal.", true, "lost"));
        // 409 = offset mismatch, 408 = server noticed the connection drop: both just reconnect.
        if (xhr.status === 409 || xhr.status === 408 || xhr.status >= 500) {
          return reject(new TransferError(String(body.error ?? "Koneksi terputus."), true, "network"));
        }
        reject(new TransferError(String(body.error ?? `Gagal (kode ${xhr.status})`), false));
      };
      xhr.onerror = () => {
        done();
        reject(new TransferError("Koneksi terputus.", true, "network"));
      };
      xhr.onabort = () => {
        done();
        // Aborted by us (cancel), by the stall detector, or by the browser when the screen locks.
        reject(new TransferError(stalled ? "Koneksi macet." : "Koneksi terputus.", true, "network"));
      };

      xhr.send(item.file.slice(offset));
    });
  }
}
