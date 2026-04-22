"use client";

import { useEffect, useState } from "react";
import {
  listCaptures,
  onQueueChange,
  type PendingCapture,
} from "@/lib/pending-queue";
import { useOnline } from "@/lib/use-online";

/**
 * Thin banner that appears at the top of the screen when:
 *  - the browser reports we're offline, OR
 *  - there are pending captures still waiting to sync.
 *
 * Kept lightweight (no portal, no animation lib) so it stays on-shell and
 * renders instantly even when the rest of the page is coming out of cache.
 */
export default function OfflineBanner() {
  const online = useOnline();
  const [pending, setPending] = useState<PendingCapture[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function reloadQueue() {
      try {
        const rows = await listCaptures();
        if (!cancelled) setPending(rows);
      } catch {
        if (!cancelled) setPending([]);
      }
    }
    reloadQueue();
    const unsub = onQueueChange(reloadQueue);

    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  const showOffline = !online;
  const showQueued = online && pending.length > 0;

  if (!showOffline && !showQueued) return null;

  return (
    <div
      role="status"
      className={`sticky top-0 z-40 w-full text-center text-xs py-1.5 px-3 ${
        showOffline
          ? "bg-amber-500 text-black"
          : "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-black"
      }`}
      style={{ paddingTop: "max(env(safe-area-inset-top), 0.375rem)" }}
    >
      {showOffline ? (
        <>
          Offline —{" "}
          {pending.length > 0
            ? `${pending.length} listing${
                pending.length === 1 ? "" : "s"
              } queued, will sync when you're back`
            : "you can still take photos; they'll analyze when you reconnect"}
        </>
      ) : (
        <>
          Syncing {pending.length} queued capture
          {pending.length === 1 ? "" : "s"}…
        </>
      )}
    </div>
  );
}
