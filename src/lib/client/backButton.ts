import { useEffect, useEffectEvent } from "react";

// Lets the phone's Back button close a full-screen overlay (gallery, photo viewer) instead of
// leaving yshare, which would also interrupt running uploads.
//
// Each open overlay adds one history entry tagged with its depth. When Back removes an entry,
// every overlay deeper than the entry now on top closes. Next.js copies its own router state into
// entries added with pushState, so going back to them doesn't trigger a navigation.

let openDepth = 0;

const depthOf = (state: unknown) =>
  typeof state === "object" && state !== null && typeof (state as { ysOverlay?: unknown }).ysOverlay === "number"
    ? (state as { ysOverlay: number }).ysOverlay
    : 0;

export function useCloseOnBack(open: boolean, close: () => void) {
  const onBack = useEffectEvent(close);

  useEffect(() => {
    if (!open) return;
    const depth = ++openDepth;
    window.history.pushState({ ysOverlay: depth }, "");
    let popped = false;

    const onPopState = (event: PopStateEvent) => {
      if (popped || depthOf(event.state) >= depth) return;
      popped = true;
      onBack();
    };
    window.addEventListener("popstate", onPopState);

    return () => {
      window.removeEventListener("popstate", onPopState);
      openDepth--;
      // Closed with a button: remove the entry this overlay added.
      if (!popped && depthOf(window.history.state) === depth) window.history.back();
    };
  }, [open]);
}
