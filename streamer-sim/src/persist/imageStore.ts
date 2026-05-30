/**
 * Tiny IndexedDB key/value store for large blobs (the generated room image).
 * localStorage caps at ~5MB and a single 1.5MB data URL there both fails to
 * write and corrupts the rest of the save, so big images live here instead.
 */

const DB_NAME = "limelight-media";
const STORE = "kv";
const ROOM_KEY = "roomImage";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function put(key: string, value: string): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function get(key: string): Promise<string | null> {
  const db = await open();
  const value = await new Promise<string | null>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve((req.result as string | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return value;
}

async function del(key: string): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function saveRoomImage(dataUrl: string | null): Promise<void> {
  try {
    if (dataUrl) await put(ROOM_KEY, dataUrl);
    else await del(ROOM_KEY);
  } catch {
    /* best-effort: image persistence is non-critical */
  }
}

export async function loadRoomImage(): Promise<string | null> {
  try {
    return await get(ROOM_KEY);
  } catch {
    return null;
  }
}

// --- Per-character portraits (same KV store, prefixed keys) ------------------

const portraitKey = (charId: string) => `portrait:${charId}`;

export async function savePortrait(charId: string, dataUrl: string): Promise<void> {
  try {
    await put(portraitKey(charId), dataUrl);
  } catch {
    /* best-effort */
  }
}

export async function loadPortrait(charId: string): Promise<string | null> {
  try {
    return await get(portraitKey(charId));
  } catch {
    return null;
  }
}

export async function deletePortrait(charId: string): Promise<void> {
  try {
    await del(portraitKey(charId));
  } catch {
    /* best-effort */
  }
}
