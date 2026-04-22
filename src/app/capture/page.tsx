"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fileToCompressedDataUrl } from "@/lib/image";
import {
  preloadBackgroundRemover,
  removeBackground,
} from "@/lib/bg-remove";
import { enqueueCapture } from "@/lib/pending-queue";
import { useOnline } from "@/lib/use-online";

interface Photo {
  id: string;
  dataUrl: string;
  processing: boolean;
}

function newPhotoId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export default function CapturePage() {
  const router = useRouter();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  // Warm up the background-removal model as soon as the page loads so the
  // first photo doesn't pay the full cold-start download.
  useEffect(() => {
    preloadBackgroundRemover();
  }, []);

  async function handleFiles(files: FileList | null) {
    if (!files) return;
    setError(null);

    const remainingSlots = 8 - photos.length;
    const incoming = Array.from(files)
      .filter((f) => f.type.startsWith("image/"))
      .slice(0, remainingSlots);

    const newEntries: Photo[] = [];
    for (const file of incoming) {
      try {
        const compressed = await fileToCompressedDataUrl(file);
        newEntries.push({
          id: newPhotoId(),
          dataUrl: compressed,
          processing: true,
        });
      } catch (e) {
        console.error(e);
      }
    }

    if (newEntries.length === 0) return;
    setPhotos((prev) => [...prev, ...newEntries]);

    // Process backgrounds in parallel; update each photo as it finishes.
    newEntries.forEach((entry) => {
      void (async () => {
        const cleaned = await removeBackground(entry.dataUrl);
        setPhotos((prev) =>
          prev.map((p) =>
            p.id === entry.id
              ? { ...p, dataUrl: cleaned, processing: false }
              : p
          )
        );
      })();
    });
  }

  function removePhoto(id: string) {
    setPhotos((prev) => prev.filter((p) => p.id !== id));
  }

  async function queueForLater(photoData: string[]) {
    await enqueueCapture(photoData);
    setPhotos([]);
    setError(null);
    setQueued(true);
    // Auto-hide the confirmation so the user can queue another one without
    // staring at the banner.
    setTimeout(() => setQueued(false), 3500);
  }

  async function analyze() {
    if (photos.length === 0) return;
    if (photos.some((p) => p.processing)) return;

    const photoData = photos.map((p) => p.dataUrl);

    // Offline fast-path: skip the fetch entirely and enqueue. The flusher
    // will replay when we reconnect.
    if (!navigator.onLine) {
      await queueForLater(photoData);
      return;
    }

    setAnalyzing(true);
    setError(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photos: photoData }),
      });
      if (!res.ok) {
        const { error: err } = await res.json().catch(() => ({ error: null }));
        throw new Error(err ?? `Request failed (${res.status})`);
      }
      const { listing } = await res.json();
      router.push(`/review/${listing.id}`);
    } catch (e) {
      // `fetch` rejects with TypeError when the request never left the device
      // (lost signal mid-tap). In that case the right move is to queue, not
      // to surface a scary error. Any non-2xx response is a real server error
      // and we still show it.
      if (e instanceof TypeError && !navigator.onLine) {
        await queueForLater(photoData);
        setAnalyzing(false);
        return;
      }
      setError(e instanceof Error ? e.message : "Unknown error");
      setAnalyzing(false);
    }
  }

  const processingCount = photos.filter((p) => p.processing).length;
  const ready = photos.length > 0 && processingCount === 0;

  // Track connectivity so the CTA reads honestly.
  const online = useOnline();

  return (
    <main className="flex-1 w-full max-w-3xl mx-auto px-4 pt-6 pb-28">
      <h1 className="text-2xl font-semibold tracking-tight">New listing</h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
        Take or upload 1–8 photos. Backgrounds are cleaned automatically before
        the AI drafts your listing.
      </p>

      <div className="mt-6 grid grid-cols-3 gap-2">
        {photos.map((photo) => (
          <div
            key={photo.id}
            className="relative aspect-square rounded-xl overflow-hidden bg-zinc-100 dark:bg-zinc-900"
            style={{
              // Checkerboard so transparency is visible after bg removal.
              backgroundImage:
                "linear-gradient(45deg, #e5e7eb 25%, transparent 25%), linear-gradient(-45deg, #e5e7eb 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e5e7eb 75%), linear-gradient(-45deg, transparent 75%, #e5e7eb 75%)",
              backgroundSize: "16px 16px",
              backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photo.dataUrl}
              alt="item photo"
              className="w-full h-full object-cover"
            />
            {photo.processing && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/45 backdrop-blur-sm text-white text-[10px] font-medium">
                <div className="flex flex-col items-center gap-1">
                  <Spinner />
                  <span>Removing bg…</span>
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={() => removePhoto(photo.id)}
              className="absolute top-1 right-1 h-6 w-6 rounded-full bg-black/70 text-white text-xs leading-none"
              aria-label="Remove photo"
            >
              ✕
            </button>
          </div>
        ))}
        {photos.length < 8 && (
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="aspect-square rounded-xl border-2 border-dashed border-zinc-300 dark:border-zinc-700 flex flex-col items-center justify-center gap-1 text-zinc-500 hover:border-zinc-500 transition-colors"
          >
            <span className="text-2xl">＋</span>
            <span className="text-xs">Add photo</span>
          </button>
        )}
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {error && (
        <div className="mt-4 p-3 rounded-lg bg-red-50 text-red-900 text-sm dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      )}

      {queued && (
        <div className="mt-4 p-3 rounded-lg bg-amber-50 text-amber-900 text-sm dark:bg-amber-950 dark:text-amber-200">
          Queued — we&apos;ll draft this listing as soon as you&apos;re back online.
        </div>
      )}

      <div className="mt-6">
        <button
          type="button"
          onClick={analyze}
          disabled={!ready || analyzing}
          className="w-full h-14 rounded-2xl bg-zinc-950 text-white font-medium disabled:opacity-40 dark:bg-white dark:text-black transition-opacity"
        >
          {analyzing
            ? "Analyzing…"
            : photos.length === 0
              ? "Add a photo to continue"
              : processingCount > 0
                ? `Cleaning ${processingCount} photo${
                    processingCount === 1 ? "" : "s"
                  }…`
                : !online
                  ? `Queue ${photos.length} photo${
                      photos.length === 1 ? "" : "s"
                    } for later`
                  : `Analyze ${photos.length} photo${
                      photos.length === 1 ? "" : "s"
                    }`}
        </button>
      </div>
    </main>
  );
}

function Spinner() {
  return (
    <svg
      className="h-5 w-5 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="3"
        strokeOpacity="0.25"
      />
      <path
        d="M12 3a9 9 0 0 1 9 9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
