/**
 * IndexedDB media library for generated images.
 *
 * Big data: URLs (room art, portraits, scenes) must not live in localStorage —
 * it caps at ~5MB and a single 1.5MB blob there corrupts the rest of the save.
 * They live here instead. Every generated image is stored permanently (viewable
 * in the Gallery) and keyed by a stable `cacheKey` so identical inputs (the same
 * character name + visual description) return the previously generated image
 * instead of spending another call.
 */
import { getActiveSlotId } from "./saves";

export type ImageKind = "room" | "portrait" | "body" | "presence" | "scene" | "corner" | "backdrop";

export interface StoredImage {
  id: string;
  /** Save slot this image belongs to. */
  slotId: string;
  /** Stable hash of the inputs; identical inputs collide so we can dedupe. */
  cacheKey: string;
  kind: ImageKind;
  /** Human-readable label for the Gallery. */
  label: string;
  /** The full prompt used to generate it. */
  prompt: string;
  /** The image itself, as a data: URL. */
  dataUrl: string;
  /** Character name at generation time. */
  characterName: string;
  /** Extra context, e.g. { zone: "couch" }. */
  meta?: Record<string, string>;
  /** If templated from another image (the T-pose body), its id. */
  sourceImageId?: string;
  createdAt: number;
  /** Supabase Storage path set after the image is uploaded to cloud. */
  cloudPath?: string;
}

const DB_NAME = "limelight-media";
const DB_VERSION = 2;
const KV = "kv";
const IMAGES = "images";
const ROOM_KEY = "roomImage";

function roomKey(slotId: string): string {
  return `${ROOM_KEY}:${slotId}`;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(KV)) db.createObjectStore(KV);
      if (!db.objectStoreNames.contains(IMAGES)) {
        const store = db.createObjectStore(IMAGES, { keyPath: "id" });
        store.createIndex("by_cacheKey", "cacheKey", { unique: false });
        store.createIndex("by_kind", "kind", { unique: false });
        store.createIndex("by_createdAt", "createdAt", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// --- generic KV (legacy room image) -----------------------------------------

async function kvPut(key: string, value: string): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(KV, "readwrite");
    tx.objectStore(KV).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function kvGet(key: string): Promise<string | null> {
  const db = await open();
  const value = await new Promise<string | null>((resolve, reject) => {
    const tx = db.transaction(KV, "readonly");
    const req = tx.objectStore(KV).get(key);
    req.onsuccess = () => resolve((req.result as string | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return value;
}

async function kvDel(key: string): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(KV, "readwrite");
    tx.objectStore(KV).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function saveRoomImage(slotId: string, dataUrl: string | null): Promise<void> {
  try {
    const key = roomKey(slotId);
    if (dataUrl) await kvPut(key, dataUrl);
    else await kvDel(key);
  } catch {
    /* best-effort: image persistence is non-critical */
  }
}

export async function loadRoomImage(slotId: string): Promise<string | null> {
  try {
    return await kvGet(roomKey(slotId));
  } catch {
    return null;
  }
}

/** One-time migration path from the old single-save room key. */
export async function migrateLegacyRoomImage(slotId: string): Promise<void> {
  try {
    const key = roomKey(slotId);
    const existing = await kvGet(key);
    if (existing) return;
    const legacy = await kvGet(ROOM_KEY);
    if (!legacy) return;
    await kvPut(key, legacy);
    await kvDel(ROOM_KEY);
  } catch {
    /* best-effort */
  }
}

// --- Per-character portraits (same KV store, prefixed keys) ------------------

const portraitKey = (charId: string) => `portrait:${charId}`;
const charBodyKey = (charId: string) => `cbody:${charId}`;

export async function savePortrait(charId: string, dataUrl: string): Promise<void> {
  try {
    await kvPut(portraitKey(charId), dataUrl);
  } catch {
    /* best-effort */
  }
}

/** Full-body T-pose reference for a named character (used in scene images). */
export async function saveCharacterBody(charId: string, dataUrl: string): Promise<void> {
  try {
    await kvPut(charBodyKey(charId), dataUrl);
  } catch {
    /* best-effort */
  }
}

export async function loadCharacterBody(charId: string): Promise<string | null> {
  try {
    return await kvGet(charBodyKey(charId));
  } catch {
    return null;
  }
}

// --- image library ----------------------------------------------------------

export async function putImage(rec: Omit<StoredImage, "slotId"> | StoredImage): Promise<StoredImage> {
  const stamped: StoredImage = {
    ...rec,
    slotId: "slotId" in rec ? rec.slotId : getActiveSlotId(),
  };
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IMAGES, "readwrite");
    tx.objectStore(IMAGES).put(stamped);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return stamped;
}

export async function getImage(id: string): Promise<StoredImage | null> {
  const slotId = getActiveSlotId();
  const db = await open();
  const rec = await new Promise<StoredImage | null>((resolve, reject) => {
    const tx = db.transaction(IMAGES, "readonly");
    const req = tx.objectStore(IMAGES).get(id);
    req.onsuccess = () => {
      const hit = (req.result as StoredImage | undefined) ?? null;
      resolve(hit?.slotId === slotId ? hit : null);
    };
    req.onerror = () => reject(req.error);
  });
  db.close();
  return rec;
}

/** Newest stored image for a cache key, or null. The cache hit. */
export async function getByCacheKey(cacheKey: string): Promise<StoredImage | null> {
  const slotId = getActiveSlotId();
  const db = await open();
  const rec = await new Promise<StoredImage | null>((resolve, reject) => {
    const tx = db.transaction(IMAGES, "readonly");
    const idx = tx.objectStore(IMAGES).index("by_cacheKey");
    const req = idx.getAll(cacheKey);
    req.onsuccess = () => {
      const all = ((req.result as StoredImage[] | undefined) ?? []).filter((r) => r.slotId === slotId);
      all.sort((a, b) => b.createdAt - a.createdAt);
      resolve(all[0] ?? null);
    };
    req.onerror = () => reject(req.error);
  });
  db.close();
  return rec;
}

export async function listImages(): Promise<StoredImage[]> {
  const slotId = getActiveSlotId();
  const db = await open();
  const all = await new Promise<StoredImage[]>((resolve, reject) => {
    const tx = db.transaction(IMAGES, "readonly");
    const req = tx.objectStore(IMAGES).getAll();
    req.onsuccess = () =>
      resolve(
        ((req.result as StoredImage[] | undefined) ?? [])
          .filter((r) => r.slotId === slotId)
          .sort((a, b) => b.createdAt - a.createdAt),
      );
    req.onerror = () => reject(req.error);
  });
  db.close();
  return all;
}

/** List all images for an explicit slot ID. Use this for background sync tasks. */
export async function listImagesForSlot(slotId: string): Promise<StoredImage[]> {
  const db = await open();
  const all = await new Promise<StoredImage[]>((resolve, reject) => {
    const tx = db.transaction(IMAGES, "readonly");
    const req = tx.objectStore(IMAGES).getAll();
    req.onsuccess = () =>
      resolve(
        ((req.result as StoredImage[] | undefined) ?? [])
          .filter((r) => r.slotId === slotId)
          .sort((a, b) => b.createdAt - a.createdAt),
      );
    req.onerror = () => reject(req.error);
  });
  db.close();
  return all;
}

/** Stamp a cloud storage path onto an existing image record. */
export async function patchImageCloudPath(id: string, cloudPath: string): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IMAGES, "readwrite");
    const store = tx.objectStore(IMAGES);
    const req = store.get(id);
    req.onsuccess = () => {
      const rec = req.result as StoredImage | undefined;
      if (rec) store.put({ ...rec, cloudPath });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function deleteImage(id: string): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IMAGES, "readwrite");
    tx.objectStore(IMAGES).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function deleteImagesForSlot(slotId: string): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IMAGES, "readwrite");
    const store = tx.objectStore(IMAGES);
    const req = store.getAll();
    req.onsuccess = () => {
      const all = (req.result as StoredImage[] | undefined) ?? [];
      for (const rec of all) {
        if (rec.slotId === slotId) store.delete(rec.id);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  try {
    await kvDel(roomKey(slotId));
  } catch {
    /* best-effort */
  }
}

export async function loadPortrait(charId: string): Promise<string | null> {
  try {
    return await kvGet(portraitKey(charId));
  } catch {
    return null;
  }
}

// --- Style-preset preview thumbnails (global, not slot-scoped) ---------------

/**
 * Previews illustrate an art-style preset with a fixed common subject, so they
 * are identical across saves. Keyed by preset id + a hash of the style text so
 * editing a preset's style invalidates its stale preview.
 */
export function stylePreviewKey(presetId: string, styleText: string): string {
  return `style-preview:${presetId}:${cyrb53(styleText)}`;
}

export async function saveStylePreview(key: string, dataUrl: string): Promise<void> {
  try {
    await kvPut(key, dataUrl);
  } catch {
    /* best-effort */
  }
}

export async function loadStylePreview(key: string): Promise<string | null> {
  try {
    return await kvGet(key);
  } catch {
    return null;
  }
}

export async function deletePortrait(charId: string): Promise<void> {
  try {
    await kvDel(portraitKey(charId));
  } catch {
    /* best-effort */
  }
}

// --- stable hashing ---------------------------------------------------------

/**
 * cyrb53 — a fast, well-distributed 53-bit string hash. Deterministic across
 * sessions so the same inputs always produce the same cache key.
 */
export function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Build a cache key from the parts that should dedupe to the same image. */
export function imageCacheKey(parts: Array<string | undefined>): string {
  return cyrb53(parts.filter(Boolean).join("|").toLowerCase().trim());
}
