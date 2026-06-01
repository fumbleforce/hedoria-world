/**
 * Cloud image sync — upload/download generated images to/from Supabase Storage.
 *
 * Storage layout: limelight-images/{userId}/{slotId}/gallery/{imageId}
 *                 limelight-images/{userId}/{slotId}/room
 *
 * Metadata for gallery images is mirrored in public.image_meta so cross-device
 * restores can reconstruct full StoredImage records without reading the blob.
 *
 * All functions are no-ops when supabaseConfigured is false.
 */

import { supabase, supabaseConfigured } from "../lib/supabase";
import type { User } from "@supabase/supabase-js";
import {
  listImagesForSlot,
  putImage,
  patchImageCloudPath,
  loadRoomImage,
  saveRoomImage,
} from "./imageStore";
import type { StoredImage } from "./imageStore";

const BUCKET = "limelight-images";

function dataUrlToBlob(dataUrl: string): { blob: Blob; mime: string } {
  const sep = dataUrl.indexOf(",");
  const header = dataUrl.slice(0, sep);
  const mime = header.match(/:(.*?);/)?.[1] ?? "image/png";
  const binary = atob(dataUrl.slice(sep + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { blob: new Blob([bytes], { type: mime }), mime };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function galleryPath(userId: string, slotId: string, imageId: string): string {
  return `${userId}/${slotId}/gallery/${imageId}`;
}

function roomPath(userId: string, slotId: string): string {
  return `${userId}/${slotId}/room`;
}

async function upsertMeta(user: User, img: StoredImage, cloudPath: string): Promise<void> {
  const { error } = await supabase.from("image_meta").upsert(
    {
      id: img.id,
      user_id: user.id,
      slot_id: img.slotId,
      cache_key: img.cacheKey,
      kind: img.kind,
      label: img.label,
      prompt: img.prompt,
      character_name: img.characterName,
      meta: img.meta ?? null,
      source_image_id: img.sourceImageId ?? null,
      cloud_path: cloudPath,
      created_at: img.createdAt,
    },
    { onConflict: "user_id,id" },
  );
  if (error) console.error("[imageSync] meta upsert failed:", img.id, error.message);
}

/**
 * Upload one gallery image to Supabase Storage and record the path in both
 * image_meta (DB) and the local IndexedDB record. Skips if already uploaded.
 */
export async function uploadGalleryImage(user: User, img: StoredImage): Promise<void> {
  if (!supabaseConfigured || img.cloudPath) return;
  const path = galleryPath(user.id, img.slotId, img.id);
  const { blob } = dataUrlToBlob(img.dataUrl);
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { upsert: true });
  if (error) {
    console.error("[imageSync] gallery upload failed:", img.id, error.message);
    return;
  }
  await upsertMeta(user, img, path);
  await patchImageCloudPath(img.id, path);
}

/**
 * Upload the active room background for a slot to Supabase Storage.
 * Safe to call repeatedly — upserts the blob.
 */
export async function syncRoomImage(user: User, slotId: string): Promise<void> {
  if (!supabaseConfigured) return;
  const dataUrl = await loadRoomImage(slotId);
  if (!dataUrl) return;
  const { blob } = dataUrlToBlob(dataUrl);
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(roomPath(user.id, slotId), blob, { upsert: true });
  if (error) console.error("[imageSync] room upload failed:", error.message);
}

/**
 * Upload all gallery images that don't have a cloudPath yet, plus the room image.
 * Run in the background after sign-in or after a new image is generated.
 */
export async function syncAllImages(user: User, slotId: string): Promise<void> {
  if (!supabaseConfigured) return;
  const images = await listImagesForSlot(slotId);
  for (const img of images.filter((i) => !i.cloudPath)) {
    await uploadGalleryImage(user, img);
  }
  await syncRoomImage(user, slotId);
}

/**
 * Download all cloud images for a slot into local IndexedDB.
 * Skips images already present locally. Used for cross-device restore.
 */
export async function restoreSlotImages(user: User, slotId: string): Promise<void> {
  if (!supabaseConfigured) return;

  // Gallery: query metadata table then download missing blobs
  const { data: metaRows, error: metaErr } = await supabase
    .from("image_meta")
    .select("*")
    .eq("user_id", user.id)
    .eq("slot_id", slotId);

  if (metaErr) {
    console.error("[imageSync] meta fetch failed:", metaErr.message);
  } else if (metaRows) {
    const local = await listImagesForSlot(slotId);
    const localIds = new Set(local.map((i) => i.id));
    for (const row of metaRows) {
      if (localIds.has(row.id)) continue;
      const { data: blob, error: dlErr } = await supabase.storage
        .from(BUCKET)
        .download(row.cloud_path);
      if (dlErr || !blob) {
        console.error("[imageSync] gallery download failed:", row.id, dlErr?.message);
        continue;
      }
      const dataUrl = await blobToDataUrl(blob);
      await putImage({
        id: row.id,
        slotId: row.slot_id,
        cacheKey: row.cache_key,
        kind: row.kind as StoredImage["kind"],
        label: row.label,
        prompt: row.prompt,
        dataUrl,
        characterName: row.character_name,
        meta: row.meta as Record<string, string> | undefined,
        sourceImageId: row.source_image_id ?? undefined,
        cloudPath: row.cloud_path,
        createdAt: row.created_at,
      });
    }
  }

  // Room background
  const existingRoom = await loadRoomImage(slotId);
  if (!existingRoom) {
    const { data: blob, error: dlErr } = await supabase.storage
      .from(BUCKET)
      .download(roomPath(user.id, slotId));
    if (!dlErr && blob) {
      const dataUrl = await blobToDataUrl(blob);
      await saveRoomImage(slotId, dataUrl);
    }
  }
}
