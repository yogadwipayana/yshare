"use client";

import { useCallback, useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from "react";
import { UploadQueue, type Destination, type PreResult, type QueueItem } from "@/lib/client/queue";
import { canKeepScreenOn, keepScreenOn } from "@/lib/client/wakeLock";
import { formatBytes } from "@/lib/format";
import type { ConflictPolicy, FolderListing, RootInfo, UploadSettings } from "@/lib/types";
import {
  ArrowUpIcon,
  CheckIcon,
  ChevronRightIcon,
  FolderIcon,
  FolderPlusIcon,
  ImageIcon,
  RefreshIcon,
  RetryIcon,
  UploadIcon,
  XIcon,
} from "./icons";
import Gallery from "./Gallery";
import QueueRow from "./QueueRow";

type Location = { root: string; path: string };

const STORAGE_KEY = "yshare:last-location";

function readStoredLocation(): Location | null {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (value && typeof value.root === "string" && typeof value.path === "string") return value;
  } catch {
    // Storage unavailable (private mode) or corrupt.
  }
  return null;
}

const locationKey = (loc: Location) => `${loc.root}\u0000${loc.path}`;

const POLICY_OPTIONS: { value: ConflictPolicy; label: string; hint: string }[] = [
  { value: "rename", label: "Ganti nama", hint: "Simpan sebagai “foto (1).jpg”" },
  { value: "overwrite", label: "Timpa", hint: "File lama diganti" },
  { value: "skip", label: "Lewati", hint: "File tidak dikirim" },
];

type Props = {
  settings: UploadSettings;
  authEnabled: boolean;
  onSessionExpired: () => void;
};

export default function Uploader({ settings, authEnabled, onSessionExpired }: Props) {
  const [queue] = useState(() => new UploadQueue(settings.parallel));
  const items = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);

  const [roots, setRoots] = useState<RootInfo[] | null>(null);
  const [chosen, setChosen] = useState<Location | null>(readStoredLocation);
  const [listing, setListing] = useState<{ key: string; data: FolderListing } | null>(null);
  const [listingError, setListingError] = useState<{ key: string; message: string } | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [policy, setPolicy] = useState<ConflictPolicy>(settings.conflictDefault);
  const [notice, setNotice] = useState<{ text: string; tone: "info" | "error" } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [newFolder, setNewFolder] = useState<{ name: string; error: string | null; busy: boolean } | null>(null);

  const fileInput = useRef<HTMLInputElement>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // The stored location may point to a root that no longer exists in the config.
  const location: Location | null =
    roots === null
      ? null
      : chosen && roots.some((r) => r.id === chosen.root)
        ? chosen
        : roots[0]
          ? { root: roots[0].id, path: "" }
          : null;
  const currentKey = location ? locationKey(location) : "";
  const locRoot = location?.root ?? null;
  const locPath = location?.path ?? "";
  const current = listing && listing.key === currentKey ? listing.data : null;
  const currentError =
    roots !== null && roots.length === 0
      ? "Daftar folder tidak bisa dimuat."
      : listingError && listingError.key === currentKey
        ? listingError.message
        : null;
  const currentRoot = roots?.find((r) => r.id === location?.root);

  const flash = useCallback((text: string, tone: "info" | "error" = "info") => {
    clearTimeout(noticeTimer.current);
    setNotice({ text, tone });
    noticeTimer.current = setTimeout(() => setNotice(null), 6000);
  }, []);

  // Load the allowed root folders once.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/roots", { cache: "no-store" })
      .then(async (res) => {
        if (res.status === 401) return onSessionExpired();
        const data = (await res.json()) as { roots: RootInfo[] };
        if (!cancelled) setRoots(data.roots);
      })
      .catch(() => !cancelled && setRoots([]));
    return () => {
      cancelled = true;
    };
  }, [onSessionExpired]);

  // Load the folder listing whenever the location changes (or after an upload lands in it).
  useEffect(() => {
    if (!locRoot) return;
    const key = locationKey({ root: locRoot, path: locPath });
    const controller = new AbortController();
    // Only the file count is shown here; the gallery loads the files themselves.
    const query = new URLSearchParams({ root: locRoot, path: locPath, limit: "0" });
    fetch(`/api/folders?${query}`, { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        if (res.status === 401) return onSessionExpired();
        const data = await res.json();
        if (!res.ok) {
          if (res.status === 404 && locPath) {
            // Folder was deleted or renamed on the PC: fall back to the root.
            setChosen({ root: locRoot, path: "" });
            flash("Folder itu sudah tidak ada. Kembali ke folder utama.", "error");
            return;
          }
          setListingError({ key, message: data.error ?? "Folder tidak bisa dibuka." });
          return;
        }
        setListing({ key, data: data as FolderListing });
        setListingError(null);
      })
      .catch((err) => {
        if (err.name !== "AbortError") setListingError({ key, message: "Tidak bisa terhubung ke server." });
      });
    return () => controller.abort();
  }, [locRoot, locPath, reloadToken, onSessionExpired, flash]);

  // Remember the last folder on this device.
  useEffect(() => {
    if (!locRoot) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ root: locRoot, path: locPath }));
    } catch {
      // Ignore: only a convenience.
    }
  }, [locRoot, locPath]);

  // Refresh the listing when an upload finishes in the folder being viewed.
  const onUploadFinished = useEffectEvent((item: QueueItem) => {
    if (item.status === "done" && locationKey(item.dest) === currentKey) setReloadToken((n) => n + 1);
  });
  const onUploadUnauthorized = useEffectEvent(() => onSessionExpired());
  useEffect(() => {
    queue.setHooks({
      onFinished: (item) => onUploadFinished(item),
      onUnauthorized: () => onUploadUnauthorized(),
    });
  }, [queue]);

  // Resume paused uploads when the screen is unlocked or the network comes back.
  useEffect(() => queue.attach(), [queue]);

  // Keep the screen on while uploading, where the browser allows it (HTTPS only).
  const uploading = items.some((i) => i.status === "uploading" || i.status === "paused" || i.status === "queued");
  useEffect(() => {
    if (!uploading) return;
    return keepScreenOn();
  }, [uploading]);
  const [screenLockSupported] = useState(canKeepScreenOn);

  // Warn before closing the tab mid-upload.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (queue.hasActive()) event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [queue]);

  // Drop files anywhere on the page.
  const onDropFiles = useEffectEvent((files: File[], folders: number) => {
    if (folders > 0) flash("Upload folder belum didukung. Buka foldernya lalu pilih file di dalamnya.", "error");
    addFiles(files);
  });
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files") ?? false;
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const transfer = e.dataTransfer;
      if (!transfer) return;
      const files: File[] = [];
      let folders = 0;
      for (const item of Array.from(transfer.items)) {
        if (item.kind !== "file") continue;
        if (item.webkitGetAsEntry?.()?.isDirectory) {
          folders++;
          continue;
        }
        const file = item.getAsFile();
        if (file) files.push(file);
      }
      onDropFiles(files, folders);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  function navigate(path: string, root = location?.root) {
    if (!root) return;
    setChosen({ root, path });
    setNewFolder(null);
  }

  const segments = location?.path ? location.path.split("/") : [];

  function destinationLabel(loc: Location): string {
    const rootName = roots?.find((r) => r.id === loc.root)?.name ?? loc.root;
    return [rootName, ...(loc.path ? loc.path.split("/") : [])].join(" / ");
  }

  function addFiles(files: File[]) {
    if (!location || files.length === 0) return;
    const dest: Destination = { ...location, label: destinationLabel(location) };
    const pre = new Map<File, PreResult>();

    for (const file of files) {
      if (file.size > settings.maxFileSize) {
        pre.set(file, { status: "failed", error: `Terlalu besar. Maksimal ${formatBytes(settings.maxFileSize)}.` });
      } else if (settings.blockedExtensions.some((ext) => file.name.toLowerCase().endsWith(ext))) {
        pre.set(file, { status: "failed", error: "Jenis file ini diblokir server." });
      }
    }

    // "skip" is decided by the server before any bytes are sent.
    queue.add(files, dest, policy, pre);
  }

  async function createFolder(event: React.FormEvent) {
    event.preventDefault();
    if (!location || !newFolder || newFolder.busy) return;
    const name = newFolder.name.trim();
    if (!name) return;
    setNewFolder({ ...newFolder, busy: true, error: null });
    try {
      const res = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ root: location.root, path: location.path, name }),
      });
      if (res.status === 401) return onSessionExpired();
      const data = await res.json();
      if (!res.ok) {
        setNewFolder({ name, busy: false, error: data.error ?? "Folder gagal dibuat." });
        return;
      }
      flash(`Folder “${data.name}” dibuat.`);
      navigate(data.path);
    } catch {
      setNewFolder({ name, busy: false, error: "Tidak bisa terhubung ke server." });
    }
  }

  async function logout() {
    if (queue.hasActive() && !confirm("Upload masih berjalan. Tetap keluar?")) return;
    queue.cancelAll();
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    onSessionExpired();
  }


  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 pb-16 sm:px-6">
      <header className="flex items-center justify-between py-4 sm:py-6">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-semibold tracking-tight">yshare</span>
          <span className="hidden text-sm text-muted sm:inline">kirim file ke PC</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setGalleryOpen(true)}
            disabled={!location}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-surface-muted hover:text-foreground disabled:opacity-40"
          >
            <ImageIcon className="size-4" />
            Galeri
          </button>
          {authEnabled && (
            <button onClick={logout} className="rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-surface-muted hover:text-foreground">
              Keluar
            </button>
          )}
        </div>
      </header>

      {notice && (
        <div
          role="status"
          className={`mb-4 flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${
            notice.tone === "error" ? "border-danger/30 bg-danger/10 text-danger" : "border-border bg-surface text-foreground"
          }`}
        >
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} aria-label="Tutup pesan" className="shrink-0 opacity-70 hover:opacity-100">
            <XIcon className="size-4" />
          </button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start lg:gap-6">
        {/* Destination folder */}
        <section aria-labelledby="dest-title" className="rounded-2xl border border-border bg-surface">
          <div className="flex items-center justify-between gap-2 px-4 pt-4">
            <h2 id="dest-title" className="text-sm font-medium text-muted">
              1. Pilih folder tujuan
            </h2>
            <button
              onClick={() => setReloadToken((n) => n + 1)}
              aria-label="Muat ulang isi folder"
              className="rounded-lg p-1.5 text-muted hover:bg-surface-muted hover:text-foreground"
            >
              <RefreshIcon className="size-4" />
            </button>
          </div>

          {roots && roots.length > 1 && (
            <div className="mt-3 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist" aria-label="Folder utama">
              {roots.map((root) => (
                <button
                  key={root.id}
                  role="tab"
                  aria-selected={root.id === location?.root}
                  onClick={() => navigate("", root.id)}
                  className={`shrink-0 rounded-full border px-3 py-1.5 text-sm transition ${
                    root.id === location?.root
                      ? "border-accent bg-accent-soft font-medium text-accent"
                      : "border-border text-muted hover:text-foreground"
                  }`}
                >
                  {root.name}
                </button>
              ))}
            </div>
          )}

          {/* Breadcrumb */}
          <nav aria-label="Lokasi folder" className="mt-3 flex flex-wrap items-center gap-0.5 px-4 text-sm">
            <button
              onClick={() => navigate("")}
              className={`rounded px-1 py-0.5 hover:bg-surface-muted ${segments.length === 0 ? "font-semibold" : "text-muted"}`}
            >
              {currentRoot?.name ?? "…"}
            </button>
            {segments.map((segment, index) => (
              <span key={index} className="flex items-center gap-0.5">
                <ChevronRightIcon className="size-3.5 text-muted" />
                <button
                  onClick={() => navigate(segments.slice(0, index + 1).join("/"))}
                  className={`max-w-[12rem] truncate rounded px-1 py-0.5 hover:bg-surface-muted ${
                    index === segments.length - 1 ? "font-semibold" : "text-muted"
                  }`}
                >
                  {segment}
                </button>
              </span>
            ))}
          </nav>

          <div className="mt-3 border-t border-border">
            {newFolder ? (
              <form onSubmit={createFolder} className="flex flex-col gap-2 px-4 py-3">
                <div className="flex gap-2">
                  <input
                    autoFocus
                    value={newFolder.name}
                    onChange={(e) => setNewFolder({ ...newFolder, name: e.target.value, error: null })}
                    placeholder="Nama folder baru"
                    aria-label="Nama folder baru"
                    className="min-w-0 flex-1 rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
                  />
                  <button
                    type="submit"
                    disabled={!newFolder.name.trim() || newFolder.busy}
                    className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
                  >
                    Buat
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewFolder(null)}
                    className="rounded-lg px-3 py-2 text-sm text-muted hover:bg-surface-muted"
                  >
                    Batal
                  </button>
                </div>
                {newFolder.error && <p className="text-sm text-danger">{newFolder.error}</p>}
              </form>
            ) : (
              <button
                onClick={() => setNewFolder({ name: "", error: null, busy: false })}
                disabled={!current}
                className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-accent hover:bg-surface-muted disabled:opacity-40"
              >
                <FolderPlusIcon />
                Folder baru di sini
              </button>
            )}
          </div>

          <ul className="max-h-[22rem] overflow-y-auto border-t border-border" aria-label="Subfolder" aria-busy={!current}>
            {segments.length > 0 && (
              <li>
                <button
                  onClick={() => navigate(segments.slice(0, -1).join("/"))}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-muted hover:bg-surface-muted"
                >
                  <ArrowUpIcon className="size-5" />
                  Naik satu tingkat
                </button>
              </li>
            )}
            {currentError && <li className="px-4 py-6 text-center text-sm text-danger">{currentError}</li>}
            {!current && !currentError && <li className="px-4 py-6 text-center text-sm text-muted">Memuat…</li>}
            {current && current.folders.length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-muted">Tidak ada subfolder.</li>
            )}
            {current?.folders.map((folder) => (
              <li key={folder.name}>
                <button
                  onClick={() => navigate(location?.path ? `${location.path}/${folder.name}` : folder.name)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-surface-muted"
                >
                  <FolderIcon className="size-5 shrink-0 text-accent" />
                  <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                  <ChevronRightIcon className="size-4 shrink-0 text-muted" />
                </button>
              </li>
            ))}
          </ul>

          {current && (
            <div className="border-t border-border px-4 py-3 text-xs text-muted">
              <div className="flex flex-wrap items-center justify-between gap-2">
                {current.fileCount > 0 ? (
                  <button
                    onClick={() => setGalleryOpen(true)}
                    className="flex items-center gap-1.5 text-accent underline-offset-2 hover:underline"
                  >
                    <ImageIcon className="size-4" />
                    Lihat {current.fileCount} file di folder ini
                  </button>
                ) : (
                  <span>Belum ada file di folder ini</span>
                )}
                {current.space && (
                  <span>
                    Sisa ruang {formatBytes(current.space.free)} dari {formatBytes(current.space.total)}
                  </span>
                )}
              </div>
            </div>
          )}
        </section>

        <div className="flex flex-col gap-4 lg:sticky lg:top-6">
          {/* Upload */}
          <section aria-labelledby="upload-title" className="rounded-2xl border border-border bg-surface p-4">
            <h2 id="upload-title" className="text-sm font-medium text-muted">
              2. Pilih file
            </h2>

            <div className="mt-3 flex items-center gap-2 rounded-xl bg-surface-muted px-3 py-2.5 text-sm">
              <FolderIcon className="size-5 shrink-0 text-accent" />
              <span className="text-muted">Simpan ke</span>
              <span className="min-w-0 flex-1 truncate font-medium">{location ? destinationLabel(location) : "…"}</span>
            </div>

            <button
              onClick={() => fileInput.current?.click()}
              disabled={!current}
              className="mt-3 flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border px-4 py-8 text-center transition hover:border-accent hover:bg-accent-soft disabled:opacity-40"
            >
              <UploadIcon className="size-8 text-accent" />
              <span className="font-medium">Pilih file</span>
              <span className="hidden text-sm text-muted sm:block">atau tarik file ke halaman ini</span>
            </button>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = "";
                addFiles(files);
              }}
            />

            <fieldset className="mt-4">
              <legend className="text-sm text-muted">Jika nama file sudah ada</legend>
              <div className="mt-2 grid grid-cols-3 gap-1 rounded-xl bg-surface-muted p-1">
                {POLICY_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    title={option.hint}
                    className={`cursor-pointer rounded-lg px-2 py-2 text-center text-sm transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/40 ${
                      policy === option.value ? "bg-surface font-medium shadow-sm" : "text-muted hover:text-foreground"
                    }`}
                  >
                    <input
                      type="radio"
                      name="policy"
                      value={option.value}
                      checked={policy === option.value}
                      onChange={() => setPolicy(option.value)}
                      className="sr-only"
                    />
                    {option.label}
                  </label>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-muted">{POLICY_OPTIONS.find((o) => o.value === policy)?.hint}</p>
            </fieldset>
          </section>

          {items.length > 0 && <QueuePanel queue={queue} items={items} currentKey={currentKey} />}

          {uploading && (
            <p className="px-1 text-xs text-muted">
              {screenLockSupported
                ? "Layar dijaga tetap menyala selama upload. Jangan tutup halaman ini."
                : "Jika layar terkunci, upload berhenti sementara dan otomatis lanjut dari posisi terakhir saat layar dibuka lagi. Jangan tutup halaman ini."}
            </p>
          )}
        </div>
      </div>

      {galleryOpen && location && (
        <Gallery
          root={location.root}
          path={location.path}
          rootName={currentRoot?.name ?? location.root}
          reloadToken={reloadToken}
          onNavigate={(path) => navigate(path)}
          onClose={() => setGalleryOpen(false)}
          onSessionExpired={onSessionExpired}
        />
      )}

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-background/80 p-6 backdrop-blur-sm">
          <div className="rounded-2xl border-2 border-dashed border-accent bg-surface px-10 py-12 text-center shadow-lg">
            <UploadIcon className="mx-auto size-10 text-accent" />
            <p className="mt-3 font-medium">Lepaskan untuk upload</p>
            <p className="mt-1 text-sm text-muted">ke {location ? destinationLabel(location) : "…"}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function QueuePanel({ queue, items, currentKey }: { queue: UploadQueue; items: QueueItem[]; currentKey: string }) {
  const count = (status: QueueItem["status"]) => items.filter((i) => i.status === status).length;
  const done = count("done");
  const skipped = count("skipped");
  const failed = count("failed");
  const uploading = items.filter((i) => i.status === "uploading");
  const pending = uploading.length + count("queued") + count("paused");
  const finished = items.length - pending;

  const totalBytes = items.filter((i) => i.status !== "canceled" && i.status !== "skipped").reduce((s, i) => s + i.file.size, 0);
  const sentBytes = items
    .filter((i) => i.status !== "canceled" && i.status !== "skipped")
    .reduce((s, i) => s + (i.status === "done" ? i.file.size : i.loaded), 0);
  const speed = uploading.reduce((s, i) => s + i.speed, 0);

  return (
    <section aria-labelledby="queue-title" className="rounded-2xl border border-border bg-surface">
      <div className="flex items-center justify-between gap-2 px-4 pt-4">
        <h2 id="queue-title" className="text-sm font-medium text-muted">
          Upload · {finished} dari {items.length} selesai
        </h2>
        <div className="flex gap-1">
          {pending > 0 && (
            <button onClick={() => queue.cancelAll()} className="rounded-lg px-2.5 py-1 text-sm text-danger hover:bg-surface-muted">
              Batalkan semua
            </button>
          )}
          {finished > 0 && (
            <button onClick={() => queue.clearFinished()} className="rounded-lg px-2.5 py-1 text-sm text-muted hover:bg-surface-muted">
              Bersihkan
            </button>
          )}
        </div>
      </div>

      {pending > 0 ? (
        <div className="px-4 pt-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-muted">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-200"
              style={{ width: `${totalBytes ? (sentBytes / totalBytes) * 100 : 0}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs tabular-nums text-muted">
            {formatBytes(sentBytes)} dari {formatBytes(totalBytes)}
            {speed > 0 && ` · ${formatBytes(speed)}/dtk`}
          </p>
        </div>
      ) : (
        <p className="flex items-center gap-1.5 px-4 pt-2 text-sm">
          {failed === 0 ? <CheckIcon className="size-4 text-success" /> : <RetryIcon className="size-4 text-danger" />}
          <span>
            {done} tersimpan
            {skipped > 0 && `, ${skipped} dilewati`}
            {failed > 0 && `, ${failed} gagal`}
          </span>
        </p>
      )}

      <ul className="mt-3 max-h-[28rem] divide-y divide-border overflow-y-auto border-t border-border">
        {items.map((item) => (
          <QueueRow
            key={item.id}
            item={item}
            showDest={`${item.dest.root}\u0000${item.dest.path}` !== currentKey}
            onCancel={() => queue.cancel(item.id)}
            onRetry={() => queue.retry(item.id)}
          />
        ))}
      </ul>
    </section>
  );
}
