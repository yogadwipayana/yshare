import type { QueueItem } from "@/lib/client/queue";
import { formatBytes, formatDuration } from "@/lib/format";
import { CheckIcon, FileIcon, RetryIcon, XIcon } from "./icons";

function statusText(item: QueueItem): string {
  const size = formatBytes(item.file.size);
  switch (item.status) {
    case "queued":
      return `Menunggu · ${size}`;
    case "uploading": {
      const percent = item.file.size ? Math.floor((item.loaded / item.file.size) * 100) : 100;
      const parts = [`${percent}%`, `${formatBytes(item.loaded)} / ${size}`];
      if (item.speed > 0) {
        parts.push(`${formatBytes(item.speed)}/dtk`);
        parts.push(`sisa ${formatDuration((item.file.size - item.loaded) / item.speed)}`);
      }
      return parts.join(" · ");
    }
    case "paused": {
      const percent = item.file.size ? Math.floor((item.loaded / item.file.size) * 100) : 0;
      return `${item.error ?? "Terputus"} · ${percent}% · lanjut otomatis`;
    }
    case "done":
      return item.renamed && item.savedAs ? `Tersimpan sebagai “${item.savedAs}”` : `Tersimpan · ${size}`;
    case "skipped":
      return "Dilewati, file dengan nama ini sudah ada";
    case "canceled":
      return "Dibatalkan";
    case "failed":
      return item.error ?? "Gagal";
  }
}

type Props = {
  item: QueueItem;
  showDest: boolean;
  onCancel: () => void;
  onRetry: () => void;
};

export default function QueueRow({ item, showDest, onCancel, onRetry }: Props) {
  const percent = item.file.size ? (item.loaded / item.file.size) * 100 : 0;
  const tone =
    item.status === "failed" || item.status === "paused"
      ? "text-danger"
      : item.status === "done"
        ? "text-success"
        : "text-muted";
  const inProgress = item.status === "queued" || item.status === "uploading" || item.status === "paused";

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div className="shrink-0">
        {item.status === "done" ? (
          <CheckIcon className="size-5 text-success" />
        ) : (
          <FileIcon className={`size-5 ${item.status === "failed" ? "text-danger" : "text-muted"}`} />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" title={item.file.name}>
          {item.file.name}
        </p>
        {showDest && <p className="truncate text-xs text-muted">→ {item.dest.label}</p>}
        {(item.status === "uploading" || item.status === "paused") && (
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-muted">
            <div
              className={`h-full rounded-full transition-[width] duration-200 ${item.status === "paused" ? "bg-danger/60" : "bg-accent"}`}
              style={{ width: `${percent}%` }}
            />
          </div>
        )}
        <p className={`mt-1 truncate text-xs tabular-nums ${tone}`} aria-live={item.status === "uploading" ? "off" : "polite"}>
          {statusText(item)}
        </p>
      </div>

      {(item.status === "failed" || item.status === "canceled" || item.status === "paused") && (
        <button
          onClick={onRetry}
          aria-label={item.status === "paused" ? `Sambungkan ulang ${item.file.name} sekarang` : `Coba lagi ${item.file.name}`}
          title={item.status === "paused" ? "Sambungkan ulang sekarang" : "Coba lagi"}
          className="shrink-0 rounded-lg p-1.5 text-muted hover:bg-surface-muted hover:text-foreground"
        >
          <RetryIcon className="size-4" />
        </button>
      )}
      {inProgress && (
        <button
          onClick={onCancel}
          aria-label={`Batalkan ${item.file.name}`}
          title="Batalkan"
          className="shrink-0 rounded-lg p-1.5 text-muted hover:bg-surface-muted hover:text-foreground"
        >
          <XIcon className="size-4" />
        </button>
      )}
    </li>
  );
}
