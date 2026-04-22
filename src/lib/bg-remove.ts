"use client";

// Lazy module cache — the imgly bundle + model is ~40MB, so we only load
// it on first use (not on every page navigation) and only in the browser.
let modulePromise: Promise<
  typeof import("@imgly/background-removal")
> | null = null;

function loadModule() {
  if (typeof window === "undefined") {
    throw new Error("bg-remove: must be called in the browser");
  }
  if (!modulePromise) {
    modulePromise = import("@imgly/background-removal");
  }
  return modulePromise;
}

/**
 * Warm the model in the background so the first real photo doesn't
 * pay the full cold-start cost. Safe to call multiple times.
 */
export function preloadBackgroundRemover() {
  if (typeof window === "undefined") return;
  loadModule().catch(() => {
    // ignore — will surface on actual use
  });
}

/**
 * Remove the background from a JPEG/PNG data URL.
 * Returns a PNG data URL with transparency. Falls back to the original
 * data URL if removal fails (network blip, unsupported browser, etc.).
 */
export async function removeBackground(dataUrl: string): Promise<string> {
  try {
    const mod = await loadModule();
    const blob = await (await fetch(dataUrl)).blob();
    const resultBlob = await mod.removeBackground(blob);
    return await blobToDataUrl(resultBlob);
  } catch (err) {
    console.warn("Background removal failed, using original photo", err);
    return dataUrl;
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
