"use client";

import { useSyncExternalStore } from "react";

/**
 * React 19-friendly hook for the browser's `navigator.onLine` flag.
 * Uses `useSyncExternalStore` instead of the classic `useEffect` +
 * `setState(navigator.onLine)` pattern because the new React 19 lint rule
 * (`react-hooks/set-state-in-effect`) flags the latter as a footgun.
 *
 * Server default is `true` — assume online during SSR so we don't briefly
 * render an offline banner when the page hydrates.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function subscribe(cb: () => void): () => void {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

function getSnapshot(): boolean {
  return navigator.onLine;
}

function getServerSnapshot(): boolean {
  return true;
}
