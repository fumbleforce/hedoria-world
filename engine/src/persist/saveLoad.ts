import Dexie from "dexie";
import {
  db,
  type SaveRow,
  type SceneSpecRow,
  type TileImageRow,
  type TranscriptRow,
} from "./db";
import type { ExpansionEntityRow } from "../world/indexer";

const DEFAULT_SAVE_ID = "default-save";

export async function ensureStoragePersistence(): Promise<boolean> {
  if (!("storage" in navigator) || !("persist" in navigator.storage)) {
    return false;
  }
  return navigator.storage.persist();
}

/**
 * Get-or-create the save row for the given `saveId`. `configHash` is a
 * fingerprint of the loaded source config; the engine writes the current
 * hash but never invalidates a save just because canon shifted (player
 * choice). Boot passes a pack-scoped id (e.g. `pack-hedoria`) so each
 * authored world keeps its own transcripts, tile images, and scene
 * specs isolated from the rest.
 */
export async function getOrCreateSave(
  configHash: string,
  seed: string,
  saveId: string = DEFAULT_SAVE_ID,
): Promise<SaveRow> {
  const now = Date.now();
  const existing = await db.saves.get(saveId);
  if (existing) {
    if (existing.configHash !== configHash) {
      await db.saves.update(saveId, { configHash, updatedAt: now });
      return { ...existing, configHash, updatedAt: now };
    }
    return existing;
  }

  const created: SaveRow = {
    saveId,
    configHash,
    seed,
    playerState: {},
    createdAt: now,
    updatedAt: now,
  };
  await db.saves.put(created);
  return created;
}

export async function updatePlayerState(
  saveId: string,
  playerState: Record<string, unknown>,
) {
  await db.saves.update(saveId, { playerState, updatedAt: Date.now() });
}

export async function listExpansionEntities(
  saveId: string,
): Promise<ExpansionEntityRow[]> {
  return db.expansionEntities
    .where("[saveId+entityType]")
    .between([saveId, Dexie.minKey], [saveId, Dexie.maxKey])
    .toArray();
}

export async function putExpansionEntity(row: ExpansionEntityRow): Promise<void> {
  await db.expansionEntities.put(row);
}

export async function putTranscript(row: TranscriptRow): Promise<void> {
  await db.transcript.put(row);
}

export async function findTranscriptByPromptHash(
  saveId: string,
  promptHash: string,
): Promise<TranscriptRow | undefined> {
  return db.transcript.where("[saveId+promptHash]").equals([saveId, promptHash]).first();
}

export async function getSceneSpecRow(
  saveId: string,
  scope: SceneSpecRow["scope"],
  ids: string,
): Promise<SceneSpecRow | undefined> {
  return db.sceneSpecs.get([saveId, scope, ids]);
}

export async function putSceneSpecRow(row: SceneSpecRow): Promise<void> {
  await db.sceneSpecs.put(row);
}

/**
 * Drop a single scene-spec row. Used by the HUD "Rebuild" action when
 * the player wants to force the tile-filler to regenerate a region or
 * location grid from scratch (e.g. when the cached LLM output placed
 * the geography opposite to the regional prose).
 */
export async function deleteSceneSpecRow(
  saveId: string,
  scope: SceneSpecRow["scope"],
  ids: string,
): Promise<void> {
  await db.sceneSpecs.delete([saveId, scope, ids]);
}

export async function listSceneSpecRows(saveId: string): Promise<SceneSpecRow[]> {
  return db.sceneSpecs
    .where("[saveId+scope]")
    .between([saveId, Dexie.minKey], [saveId, Dexie.maxKey])
    .toArray();
}

export async function getTileImageRow(
  saveId: string,
  key: string,
): Promise<TileImageRow | undefined> {
  return db.tileImages.get([saveId, key]);
}

export async function putTileImageRow(row: TileImageRow): Promise<void> {
  await db.tileImages.put(row);
}

export async function listTileImageRows(saveId: string): Promise<TileImageRow[]> {
  return db.tileImages.where("saveId").equals(saveId).toArray();
}

/**
 * Remove a single tile-image row. Used by the cache's per-grid "redraw"
 * action so the next render kicks off a fresh generation instead of
 * returning the previously persisted bytes.
 */
export async function deleteTileImageRow(
  saveId: string,
  key: string,
): Promise<void> {
  await db.tileImages.delete([saveId, key]);
}

/**
 * Clear LLM-derived caches for a save: prompt transcripts, classified scene
 * specs (incl. tile grids), and generated tile images. Hand-authored save
 * state (player position, expansion entities, etc.) is preserved.
 *
 * Use when:
 *   - You've switched LLM providers (e.g. mock -> Gemini) and the transcript
 *     cache is replaying old responses.
 *   - You've edited the canonical config.json and want fresh tile fills.
 *
 * Returns the row counts that were removed, for diagnostics.
 */
export async function clearAiCache(saveId: string): Promise<{
  transcripts: number;
  sceneSpecs: number;
  tileImages: number;
}> {
  const transcripts = await db.transcript
    .where("[saveId+callId]")
    .between([saveId, Dexie.minKey], [saveId, Dexie.maxKey])
    .delete();
  const sceneSpecs = await db.sceneSpecs
    .where("[saveId+scope]")
    .between([saveId, Dexie.minKey], [saveId, Dexie.maxKey])
    .delete();
  const tileImages = await db.tileImages.where("saveId").equals(saveId).delete();
  return { transcripts, sceneSpecs, tileImages };
}

export async function exportSaveJson(saveId: string): Promise<string> {
  const save = await db.saves.get(saveId);
  const expansion = await db.expansionEntities
    .where("[saveId+entityType]")
    .between([saveId, Dexie.minKey], [saveId, Dexie.maxKey])
    .toArray();
  const transcript = await db.transcript
    .where("[saveId+callId]")
    .between([saveId, Dexie.minKey], [saveId, Dexie.maxKey])
    .toArray();
  return JSON.stringify({ save, expansion, transcript }, null, 2);
}
