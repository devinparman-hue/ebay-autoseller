"use client";

/**
 * IndexedDB-backed queue of captures that were taken while the device was
 * offline. Each entry holds the compressed photo data URLs so we can replay
 * `POST /api/analyze` as soon as connectivity comes back.
 *
 * We avoid localStorage because photos are much larger than the 5MB per-origin
 * quota. IndexedDB gives us ~50MB+ on mobile browsers without fuss.
 *
 * This is a purposefully tiny wrapper — one object store, no migrations, no
 * schema versioning beyond DB_VERSION. If the API grows, consider pulling in
 * the `idb` package.
 */

const DB_NAME = "ebay-lister";
const DB_VERSION = 1;
const STORE = "pending-captures";

export interface PendingCapture {
  id: string;
  photos: string[]; // compressed JPEG data URLs, already background-removed
  createdAt: string; // ISO
  lastError?: string;
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && "indexedDB" in window;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isBrowser()) {
      reject(new Error("IndexedDB is not available in this environment"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
    req.onsuccess = () => resolve(req.result);
  });
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

function newId(): string {
  return (
    Math.random().toString(36).slice(2) + Date.now().toString(36)
  );
}

export async function enqueueCapture(photos: string[]): Promise<PendingCapture> {
  const entry: PendingCapture = {
    id: newId(),
    photos,
    createdAt: new Date().toISOString(),
  };
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  await wrap(tx.objectStore(STORE).put(entry));
  db.close();
  notifyQueueChange();
  return entry;
}

export async function listCaptures(): Promise<PendingCapture[]> {
  if (!isBrowser()) return [];
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  const rows = await wrap(tx.objectStore(STORE).getAll());
  db.close();
  return (rows as PendingCapture[]).sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt)
  );
}

export async function markCaptureError(
  id: string,
  message: string
): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  const existing = (await wrap(store.get(id))) as PendingCapture | undefined;
  if (existing) {
    existing.lastError = message;
    await wrap(store.put(existing));
  }
  db.close();
  notifyQueueChange();
}

export async function removeCapture(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  await wrap(tx.objectStore(STORE).delete(id));
  db.close();
  notifyQueueChange();
}

/* ───────── in-tab change notifications ─────────
 * IndexedDB doesn't have a built-in "store changed" event. We use a custom
 * event so sibling components (badge, flusher) can re-read the queue after
 * a mutation happens in the same tab.
 */

const CHANGE_EVENT = "pending-queue-change";

function notifyQueueChange() {
  if (isBrowser()) {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  }
}

export function onQueueChange(handler: () => void): () => void {
  if (!isBrowser()) return () => {};
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
}
