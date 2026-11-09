"use client";

import { useState } from "react";

export default function PinForm({ onSuccess }: { onSuccess: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [linkExpired] = useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("link") === "expired",
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pin.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Gagal masuk.");
        setPin("");
        return;
      }
      window.history.replaceState(null, "", "/");
      onSuccess();
    } catch {
      setError("Tidak bisa terhubung ke server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 shadow-sm sm:p-8">
        <p className="text-lg font-semibold tracking-tight">yshare</p>
        <h1 className="mt-6 text-xl font-semibold">Masukkan PIN</h1>
        <p className="mt-1.5 text-sm text-muted">
          PIN 6 digit tampil di terminal PC yang menjalankan yshare. Bisa juga scan QR code di sana untuk langsung masuk.
        </p>

        {linkExpired && (
          <p className="mt-4 rounded-lg bg-surface-muted px-3 py-2 text-sm text-muted">
            Link QR sudah tidak berlaku, mungkin karena server di-restart. Scan QR yang baru atau masukkan PIN.
          </p>
        )}

        <label htmlFor="pin" className="sr-only">
          PIN
        </label>
        <input
          id="pin"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          placeholder="••••••"
          className="mt-6 w-full rounded-xl border border-border bg-surface-muted px-4 py-3 text-center font-mono text-2xl tracking-[0.5em] outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
        />

        {error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={pin.length !== 6 || busy}
          className="mt-5 w-full rounded-xl bg-accent px-4 py-3 font-medium text-white transition disabled:opacity-40"
        >
          {busy ? "Memeriksa…" : "Masuk"}
        </button>
      </form>
    </main>
  );
}
