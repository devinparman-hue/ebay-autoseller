/// <reference lib="webworker" />
// ^^ Pulls in the `ServiceWorkerGlobalScope` types for this file only —
// our tsconfig.lib is "dom" (for the rest of the app), which wouldn't
// otherwise know what a service worker is.

import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

// Tell TypeScript about the globals Serwist injects into the service worker.
declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
  // Fall back to the cached /capture page on navigation misses so the app
  // shell still renders when offline.
  fallbacks: {
    entries: [
      {
        url: "/capture",
        matcher({ request }) {
          return request.destination === "document";
        },
      },
    ],
  },
});

serwist.addEventListeners();
