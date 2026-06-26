// Remembers the user's chosen export folder across sessions.
//
// Uses the File System Access API: a FileSystemDirectoryHandle is structured-
// cloneable, so we persist it in IndexedDB and reuse it on later downloads —
// no folder picker after the first time. Chromium (Chrome/Edge) only; callers
// fall back to a normal browser download where this isn't supported.

const DB_NAME = "cvideo";
const STORE = "handles";
const KEY = "exportDir";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DirHandle = any; // FileSystemDirectoryHandle (lib.dom types are partial)

export const exportDirSupported = (): boolean =>
  typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker ===
  "function";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet<T>(key: string): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const r = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
        r.onsuccess = () => resolve(r.result as T);
        r.onerror = () => reject(r.error);
      })
  );
}

function idbSet(key: string, val: unknown): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(val, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      })
  );
}

function idbDel(key: string): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      })
  );
}

// Confirm we still hold read/write permission (may re-prompt after a reload —
// must be called from a user gesture). Returns true if granted.
async function verifyRW(handle: DirHandle): Promise<boolean> {
  const opts = { mode: "readwrite" as const };
  try {
    if ((await handle.queryPermission(opts)) === "granted") return true;
    return (await handle.requestPermission(opts)) === "granted";
  } catch {
    return false;
  }
}

/** The remembered folder if usable (permission granted), else null. */
export async function getExportDir(): Promise<DirHandle | null> {
  const h = await idbGet<DirHandle>(KEY).catch(() => undefined);
  if (!h) return null;
  return (await verifyRW(h)) ? h : null;
}

/** Just the remembered folder's name (for display), without touching permissions. */
export async function getExportDirName(): Promise<string | null> {
  const h = await idbGet<DirHandle>(KEY).catch(() => undefined);
  return h ? (h.name as string) : null;
}

/** Prompt for a folder, persist it, and return the handle (null if cancelled). */
export async function pickExportDir(): Promise<DirHandle | null> {
  const w = window as unknown as {
    showDirectoryPicker?: (o?: unknown) => Promise<DirHandle>;
  };
  if (!w.showDirectoryPicker) return null;
  try {
    const h = await w.showDirectoryPicker({ mode: "readwrite", id: "cvideo-export" });
    if (!(await verifyRW(h))) return null;
    await idbSet(KEY, h);
    return h;
  } catch (e) {
    return null; // AbortError (cancel) or unsupported → caller handles
  }
}

export async function clearExportDir(): Promise<void> {
  await idbDel(KEY).catch(() => {});
}
