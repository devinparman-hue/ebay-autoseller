"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  listCaptures,
  markCaptureError,
  removeCapture,
} from "@/lib/pending-queue";

/**
 * Mount-once invisible component that walks the pending-capture queue and
 * replays each one against /api/analyze as soon as connectivity is back.
 *
 * Runs:
 *  - on initial mount (to handle captures queued in a previous session)
 *  - whenever the `online` event fires
 *
 * Uses a ref-guard so we never run two flushes concurrently — if a sync is
 * still in flight when the next trigger fires, we skip. The next trigger or
 * a page nav will pick it up.
 */
export default function PendingQueueFlusher() {
  const router = useRouter();
  const flushing = useRef(false);

  useEffect(() => {
    async function flush() {
      if (flushing.current) return;
      if (!navigator.onLine) return;
      flushing.current = true;
      try {
        const queue = await listCaptures();
        let succeeded = 0;
        for (const entry of queue) {
          try {
            const res = await fetch("/api/analyze", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ photos: entry.photos }),
            });
            if (!res.ok) {
              const { error } = await res
                .json()
                .catch(() => ({ error: null }));
              throw new Error(error ?? `Request failed (${res.status})`);
            }
            await removeCapture(entry.id);
            succeeded += 1;
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Unknown error";
            await markCaptureError(entry.id, msg);
            // If a single entry fails, keep trying the others — a vision
            // outage on one listing shouldn't block the rest.
          }
        }
        if (succeeded > 0) {
          // Refresh any server component that's currently rendered so the
          // new listings show up in /inventory without a manual reload.
          router.refresh();
        }
      } finally {
        flushing.current = false;
      }
    }

    flush();
    window.addEventListener("online", flush);
    return () => {
      window.removeEventListener("online", flush);
    };
  }, [router]);

  return null;
}
