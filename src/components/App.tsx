"use client";

import { useCallback, useEffect, useState } from "react";
import type { SessionInfo } from "@/lib/types";
import PinForm from "./PinForm";
import Uploader from "./Uploader";

type View =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "login" }
  | { kind: "ready"; settings: NonNullable<SessionInfo["settings"]>; authEnabled: boolean };

export default function App() {
  const [view, setView] = useState<View>({ kind: "loading" });

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/session", { cache: "no-store" });
      if (!res.ok) throw new Error(`Server membalas ${res.status}`);
      const info = (await res.json()) as SessionInfo;
      setView(
        info.authenticated && info.settings
          ? { kind: "ready", settings: info.settings, authEnabled: info.authEnabled }
          : { kind: "login" },
      );
    } catch {
      setView({ kind: "error", message: "Tidak bisa terhubung ke server yshare. Pastikan server masih berjalan." });
    }
  }, []);

  useEffect(() => {
    // Fetching on mount; the state update happens after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  if (view.kind === "loading") {
    return <div className="grid min-h-dvh place-items-center text-sm text-muted">Memuat…</div>;
  }
  if (view.kind === "error") {
    return (
      <div className="grid min-h-dvh place-items-center px-6">
        <div className="max-w-sm text-center">
          <p className="text-sm text-muted">{view.message}</p>
          <button
            onClick={() => {
              setView({ kind: "loading" });
              void refresh();
            }}
            className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white"
          >
            Coba lagi
          </button>
        </div>
      </div>
    );
  }
  if (view.kind === "login") return <PinForm onSuccess={refresh} />;
  return (
    <Uploader
      settings={view.settings}
      authEnabled={view.authEnabled}
      onSessionExpired={() => setView({ kind: "login" })}
    />
  );
}
