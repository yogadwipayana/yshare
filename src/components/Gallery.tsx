"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useCloseOnBack } from "@/lib/client/backButton";
import { formatBytes } from "@/lib/format";
import { canThumbnail, extensionOf, mediaInfo, type MediaKind } from "@/lib/media";
import { fileVersion } from "@/lib/serve";
import type { FolderListing } from "@/lib/types";
import {
  ArrowUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  FileIcon,
  FolderIcon,
  MusicIcon,
  PlayIcon,
  RefreshIcon,
  XIcon,
} from "./icons";

type GalleryFile = FolderListing["files"][number] & { kind: MediaKind };
type Filter = "all" | MediaKind;

const PAGE = 60;
const MAX_FILES = 2000;

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "Semua" },
  { value: "image", label: "Foto" },
  { value: "video", label: "Video" },
  { value: "audio", label: "Audio" },
  { value: "other", label: "Lainnya" },
];

type Props = {
  root: string;
  path: string;
  rootName: string;
  /** Changes when an upload lands in this folder, so the grid shows it. */
  reloadToken: number;
  onNavigate: (path: string) => void;
  onClose: () => void;
  onSessionExpired: () => void;
};

export default function Gallery({ root, path, rootName, reloadToken, onNavigate, onClose, onSessionExpired }: Props) {
  const key = `${root}\u0000${path}`;
  const [listing, setListing] = useState<{ key: string; data: FolderListing } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [filter, setFilter] = useState<Filter>("all");
  const [shown, setShown] = useState({ key: "", count: PAGE });
  const [viewing, setViewing] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);

  useCloseOnBack(true, onClose);

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ root, path, limit: String(MAX_FILES) });
    fetch(`/api/folders?${query}`, { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        if (res.status === 401) return onSessionExpired();
        const data = await res.json();
        if (!res.ok) {
          setError({ key, message: data.error ?? "Folder tidak bisa dibuka." });
          return;
        }
        setListing({ key, data: data as FolderListing });
        setError(null);
      })
      .catch((err) => {
        if (err.name !== "AbortError") setError({ key, message: "Tidak bisa terhubung ke server." });
      });
    return () => controller.abort();
  }, [root, path, key, reloadToken, refresh, onSessionExpired]);

  // The page behind the gallery shouldn't scroll along.
  useEffect(() => {
    const html = document.documentElement;
    const previous = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      html.style.overflow = previous;
    };
  }, []);

  const current = listing?.key === key ? listing.data : null;
  const currentError = error?.key === key ? error.message : null;
  const files: GalleryFile[] = (current?.files ?? []).map((file) => ({ ...file, kind: mediaInfo(file.name).kind }));
  const counts: Record<Filter, number> = { all: files.length, image: 0, video: 0, audio: 0, other: 0 };
  for (const file of files) counts[file.kind]++;
  const activeFilter = counts[filter] > 0 ? filter : "all";
  const filtered = activeFilter === "all" ? files : files.filter((file) => file.kind === activeFilter);
  const shownKey = `${key}\u0000${activeFilter}`;
  const count = shown.key === shownKey ? shown.count : PAGE;
  const hasMore = filtered.length > count;
  const viewerIndex = viewing === null ? -1 : filtered.findIndex((file) => file.name === viewing);
  const segments = path ? path.split("/") : [];
  const usedFilters = FILTERS.filter((f) => f.value === "all" || counts[f.value] > 0);

  const url = (file: GalleryFile, extra?: Record<string, string>) =>
    `/api/files?${new URLSearchParams({ root, path, name: file.name, v: fileVersion(file), ...extra })}`;

  // Render the grid in pages; more tiles are added as the user scrolls near the end.
  useEffect(() => {
    const target = sentinel.current;
    if (!target || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) setShown({ key: shownKey, count: count + PAGE });
      },
      { root: scroller.current, rootMargin: "800px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, shownKey, count]);

  const step = (delta: number) => {
    const next = filtered[viewerIndex + delta];
    if (next) setViewing(next.name);
  };

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (viewerIndex === -1) {
      if (event.key === "Escape") onClose();
      return;
    }
    if (event.key === "Escape") setViewing(null);
    // Arrow keys on a focused video seek it instead.
    if (event.target instanceof HTMLMediaElement) return;
    if (event.key === "ArrowLeft") step(-1);
    if (event.key === "ArrowRight") step(1);
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  return (
    <div
      ref={scroller}
      role="dialog"
      aria-modal="true"
      aria-labelledby="gallery-title"
      className="fixed inset-0 z-40 overflow-y-auto overscroll-contain bg-background"
    >
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-1 px-2 py-2 sm:px-4">
          <button
            autoFocus
            onClick={onClose}
            aria-label="Tutup galeri"
            className="rounded-lg p-2 text-muted hover:bg-surface-muted hover:text-foreground"
          >
            <ChevronLeftIcon />
          </button>
          <div className="min-w-0 flex-1">
            <h2 id="gallery-title" className="font-semibold leading-tight">
              Galeri
            </h2>
            <nav aria-label="Lokasi folder" className="flex min-w-0 items-center gap-0.5 text-xs text-muted">
              <button onClick={() => onNavigate("")} className="shrink-0 hover:text-foreground">
                {rootName}
              </button>
              {segments.map((segment, index) => (
                <span key={index} className="flex min-w-0 items-center gap-0.5">
                  <ChevronRightIcon className="size-3 shrink-0" />
                  <button
                    onClick={() => onNavigate(segments.slice(0, index + 1).join("/"))}
                    className={`truncate hover:text-foreground ${index === segments.length - 1 ? "text-foreground" : ""}`}
                  >
                    {segment}
                  </button>
                </span>
              ))}
            </nav>
          </div>
          <button
            onClick={() => setRefresh((n) => n + 1)}
            aria-label="Muat ulang galeri"
            className="rounded-lg p-2 text-muted hover:bg-surface-muted hover:text-foreground"
          >
            <RefreshIcon className="size-4" />
          </button>
        </div>

        {usedFilters.length > 2 && (
          <div className="mx-auto flex max-w-6xl gap-2 overflow-x-auto px-3 pb-2.5 sm:px-5" role="tablist" aria-label="Jenis file">
            {usedFilters.map((option) => (
              <button
                key={option.value}
                role="tab"
                aria-selected={activeFilter === option.value}
                onClick={() => setFilter(option.value)}
                className={`shrink-0 rounded-full border px-3 py-1 text-sm transition ${
                  activeFilter === option.value
                    ? "border-accent bg-accent-soft font-medium text-accent"
                    : "border-border text-muted hover:text-foreground"
                }`}
              >
                {option.label} <span className="tabular-nums opacity-70">{counts[option.value]}</span>
              </button>
            ))}
          </div>
        )}
      </header>

      <div className="mx-auto max-w-6xl px-2 pb-12 pt-3 sm:px-4">
        {current && (segments.length > 0 || current.folders.length > 0) && (
          <div className="mb-3 flex gap-2 overflow-x-auto pb-1" aria-label="Subfolder">
            {segments.length > 0 && (
              <button
                onClick={() => onNavigate(segments.slice(0, -1).join("/"))}
                className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-muted hover:text-foreground"
              >
                <ArrowUpIcon className="size-4" />
                Naik
              </button>
            )}
            {current.folders.map((folder) => (
              <button
                key={folder.name}
                onClick={() => onNavigate(path ? `${path}/${folder.name}` : folder.name)}
                className="flex max-w-[14rem] shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm hover:border-accent"
              >
                <FolderIcon className="size-4 shrink-0 text-accent" />
                <span className="truncate">{folder.name}</span>
              </button>
            ))}
          </div>
        )}

        {currentError && <p className="py-16 text-center text-sm text-danger">{currentError}</p>}
        {!current && !currentError && <p className="py-16 text-center text-sm text-muted">Memuat…</p>}
        {current && files.length === 0 && (
          <p className="py-16 text-center text-sm text-muted">Belum ada file di folder ini.</p>
        )}

        <ul className="grid grid-cols-3 gap-1 sm:grid-cols-4 sm:gap-2 md:grid-cols-5 lg:grid-cols-6">
          {filtered.slice(0, count).map((file) => (
            <li key={file.name}>
              <Tile
                file={file}
                src={file.kind === "image" && canThumbnail(file.name) ? url(file, { thumb: "1" }) : url(file)}
                scroller={scroller}
                onOpen={() => setViewing(file.name)}
              />
            </li>
          ))}
        </ul>
        <div ref={sentinel} aria-hidden="true" />

        {current && current.fileCount > current.files.length && (
          <p className="mt-6 text-center text-xs text-muted">
            Menampilkan {current.files.length} file terbaru dari {current.fileCount}.
          </p>
        )}
      </div>

      {viewerIndex !== -1 && (
        <Viewer
          files={filtered}
          index={viewerIndex}
          url={url}
          onStep={step}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}

function Tile({
  file,
  src,
  scroller,
  onOpen,
}: {
  file: GalleryFile;
  src: string;
  scroller: React.RefObject<HTMLDivElement | null>;
  onOpen: () => void;
}) {
  const [broken, setBroken] = useState(false);
  const [near, setNear] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const isVideo = file.kind === "video";

  // Videos have no server-side thumbnail: the browser grabs a frame, but only for tiles on screen.
  useEffect(() => {
    const target = ref.current;
    if (!isVideo || !target) return;
    const observer = new IntersectionObserver((entries) => setNear(entries[0]?.isIntersecting ?? false), {
      root: scroller.current,
      rootMargin: "300px 0px",
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [isVideo, scroller]);

  const showImage = file.kind === "image" && !broken;
  const showVideo = isVideo && !broken;

  return (
    <button
      ref={ref}
      onClick={onOpen}
      aria-label={`${file.name}, ${formatBytes(file.size)}`}
      className="group relative block aspect-square w-full overflow-hidden rounded-md bg-surface-muted outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {showImage && (
        // eslint-disable-next-line @next/next/no-img-element -- served by our own API; next/image can't add the session cookie.
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
          className="size-full object-cover transition duration-200 group-hover:scale-[1.03]"
        />
      )}
      {showVideo && near && (
        <video
          src={`${src}#t=0.1`}
          preload="metadata"
          muted
          playsInline
          onError={() => setBroken(true)}
          className="pointer-events-none size-full object-cover"
        />
      )}
      {showVideo && (
        <span className="absolute bottom-1.5 left-1.5 grid size-6 place-items-center rounded-full bg-black/55 text-white">
          <PlayIcon className="size-3.5" />
        </span>
      )}
      {!showImage && !showVideo && (
        <span className="flex size-full flex-col items-center justify-center gap-1.5 p-2 text-center">
          {file.kind === "audio" ? (
            <MusicIcon className="size-7 text-accent" />
          ) : (
            <FileIcon className="size-7 text-muted" />
          )}
          <span className="line-clamp-2 break-all text-[11px] leading-tight text-foreground">{file.name}</span>
          <span className="text-[10px] uppercase tabular-nums text-muted">
            {extensionOf(file.name).slice(1) || "file"} · {formatBytes(file.size)}
          </span>
        </span>
      )}
    </button>
  );
}

function Viewer({
  files,
  index,
  url,
  onStep,
  onClose,
}: {
  files: GalleryFile[];
  index: number;
  url: (file: GalleryFile, extra?: Record<string, string>) => string;
  onStep: (delta: number) => void;
  onClose: () => void;
}) {
  const file = files[index];
  const [failed, setFailed] = useState<string | null>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  useCloseOnBack(true, onClose);

  const previewable = file.kind !== "other" && failed !== file.name;
  const downloadUrl = url(file, { dl: "1" });

  // Fetch the next photo while this one is being looked at.
  const next = files[index + 1];
  const nextSrc = next?.kind === "image" ? url(next) : null;
  useEffect(() => {
    if (!nextSrc) return;
    const image = new Image();
    image.src = nextSrc;
  }, [nextSrc]);

  return (
    <div role="dialog" aria-modal="true" aria-label={file.name} className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      <div className="flex items-center gap-1 px-2 py-2 sm:px-4">
        <button autoFocus onClick={onClose} aria-label="Tutup" className="rounded-full p-2 hover:bg-white/10">
          <XIcon />
        </button>
        <div className="min-w-0 flex-1 px-1">
          <p className="truncate text-sm font-medium">{file.name}</p>
          <p className="truncate text-xs tabular-nums text-white/60">
            {index + 1} dari {files.length} · {formatBytes(file.size)} ·{" "}
            {new Date(file.modified).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}
          </p>
        </div>
        <a href={downloadUrl} download={file.name} aria-label="Unduh" title="Unduh" className="rounded-full p-2 hover:bg-white/10">
          <DownloadIcon />
        </a>
      </div>

      <div
        className="relative min-h-0 flex-1"
        onTouchStart={(event) => {
          const t = event.touches[0];
          touch.current = event.touches.length === 1 ? { x: t.clientX, y: t.clientY } : null;
        }}
        onTouchEnd={(event) => {
          const start = touch.current;
          touch.current = null;
          // Swiping over a video or audio player would fight with its seek bar.
          if (!start || (previewable && (file.kind === "video" || file.kind === "audio"))) return;
          const t = event.changedTouches[0];
          const dx = t.clientX - start.x;
          const dy = t.clientY - start.y;
          if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) onStep(dx < 0 ? 1 : -1);
        }}
      >
        {previewable && file.kind === "image" && (
          <>
            {canThumbnail(file.name) && (
              // Shown instantly from cache while the full photo loads on top of it.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url(file, { thumb: "1" })} alt="" aria-hidden="true" className="absolute inset-0 size-full object-contain" />
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={file.name}
              src={url(file)}
              alt={file.name}
              onError={() => setFailed(file.name)}
              className="absolute inset-0 size-full object-contain"
            />
          </>
        )}
        {previewable && file.kind === "video" && (
          <video
            key={file.name}
            src={url(file)}
            controls
            autoPlay
            playsInline
            onError={() => setFailed(file.name)}
            className="absolute inset-0 size-full object-contain"
          />
        )}
        {previewable && file.kind === "audio" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 px-6">
            <MusicIcon className="size-16 text-white/70" />
            <audio key={file.name} src={url(file)} controls autoPlay onError={() => setFailed(file.name)} className="w-full max-w-md" />
          </div>
        )}
        {!previewable && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <FileIcon className="size-16 text-white/70" />
            <p className="max-w-md break-all font-medium">{file.name}</p>
            <p className="text-sm text-white/60">
              {file.kind === "other"
                ? "Pratinjau tidak tersedia untuk jenis file ini."
                : "Browser ini tidak bisa menampilkan file ini."}
            </p>
            <a
              href={downloadUrl}
              download={file.name}
              className="mt-2 flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-black"
            >
              <DownloadIcon className="size-4" />
              Unduh ({formatBytes(file.size)})
            </a>
          </div>
        )}

        {index > 0 && (
          <button
            onClick={() => onStep(-1)}
            aria-label="Sebelumnya"
            className="absolute left-2 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-black/40 hover:bg-black/70"
          >
            <ChevronLeftIcon />
          </button>
        )}
        {index < files.length - 1 && (
          <button
            onClick={() => onStep(1)}
            aria-label="Berikutnya"
            className="absolute right-2 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-black/40 hover:bg-black/70"
          >
            <ChevronRightIcon />
          </button>
        )}
      </div>
    </div>
  );
}
