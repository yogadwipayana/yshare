// Keeps the phone screen on while uploading, where the browser allows it.
// The Screen Wake Lock API only exists on HTTPS pages (and localhost). yshare runs on plain HTTP
// on the LAN, so on phones this is usually unavailable; resumable uploads cover that case.

type Sentinel = { release: () => Promise<void> };
type WakeLockNavigator = Navigator & { wakeLock?: { request: (type: "screen") => Promise<Sentinel> } };

export function canKeepScreenOn(): boolean {
  return typeof navigator !== "undefined" && "wakeLock" in navigator;
}

/** Requests a screen wake lock (re-acquired whenever the page becomes visible). Returns a release function. */
export function keepScreenOn(): () => void {
  const nav = navigator as WakeLockNavigator;
  if (!nav.wakeLock) return () => {};

  let sentinel: Sentinel | null = null;
  let stopped = false;
  const acquire = async () => {
    if (stopped || document.visibilityState !== "visible") return;
    try {
      sentinel = await nav.wakeLock!.request("screen");
      if (stopped) await sentinel.release();
    } catch {
      // Denied (battery saver, etc.). Uploads still resume after the screen comes back.
    }
  };
  // The browser drops the lock whenever the page is hidden.
  const onVisible = () => void acquire();
  document.addEventListener("visibilitychange", onVisible);
  void acquire();

  return () => {
    stopped = true;
    document.removeEventListener("visibilitychange", onVisible);
    void sentinel?.release().catch(() => {});
  };
}
