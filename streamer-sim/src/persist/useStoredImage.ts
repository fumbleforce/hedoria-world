import { useEffect } from "react";
import { useStore } from "../state/store";
import { getImage } from "./imageStore";

/**
 * Resolve a stored image id to its data URL, lazily loading it from IndexedDB
 * into the in-memory cache if it isn't there yet. This self-heals any case where
 * a persisted id (portrait, body, presence, last visualization) is referenced
 * before the boot-time hydrate has populated the cache.
 */
export function useStoredImage(id: string | null | undefined): string | undefined {
  const url = useStore((s) => (id ? s.imageCache[id] : undefined));
  useEffect(() => {
    if (!id || url) return;
    let cancelled = false;
    void getImage(id).then((rec) => {
      if (!cancelled && rec) useStore.getState().cacheImage(rec.id, rec.dataUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [id, url]);
  return url;
}
