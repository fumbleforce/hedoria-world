import Dexie from "dexie";
import { db, type SaveRow, type SceneSpecRow, type TextureRow, type TranscriptRow } from "./db";
import type { ExpansionEntityRow } from "../world/indexer";

const DEFAULT_SAVE_ID = "default-save";

export async function ensureStoragePersistence(): Promise<boolean> {
  if (!("storage" in navigator) || !("persist" in navigator.storage)) {
    return false;
  }
  return navigator.storage.persist();
}

export async function getOrCreateSave(packId: string, bundleHash: string, seed: string): Promise<SaveRow> {
  const now = Date.now();
  const existing = await db.saves.get(DEFAULT_SAVE_ID);
  if (existing) return existing;

  const created: SaveRow = {
    saveId: DEFAULT_SAVE_ID,
    packId,
    bundleHash,
    manifestHash: "",
    seed,
    playerState: {},
    createdAt: now,
    updatedAt: now,
  };
  await db.saves.put(created);
  return created;
}

export async function updatePlayerState(saveId: string, playerState: Record<string, unknown>) {
  await db.saves.update(saveId, { playerState, updatedAt: Date.now() });
}

export async function listExpansionEntities(saveId: string): Promise<ExpansionEntityRow[]> {
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

export async function findTranscriptByPromptHash(saveId: string, promptHash: string): Promise<TranscriptRow | undefined> {
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

export async function listSceneSpecRows(saveId: string): Promise<SceneSpecRow[]> {
  return db.sceneSpecs
    .where("[saveId+scope]")
    .between([saveId, Dexie.minKey], [saveId, Dexie.maxKey])
    .toArray();
}

export async function getTextureRow(saveId: string, key: string): Promise<TextureRow | undefined> {
  return db.textures.get([saveId, key]);
}

export async function putTextureRow(row: TextureRow): Promise<void> {
  await db.textures.put(row);
}

export async function listTextureRows(saveId: string): Promise<TextureRow[]> {
  return db.textures.where("saveId").equals(saveId).toArray();
}

/**
 * Clear LLM-derived caches for a save: prompt transcripts, classified scene
 * specs, and generated textures. Hand-authored save state (player position,
 * expansion entities, etc.) is preserved.
 *
 * Use when:
 *   - You've switched LLM providers (e.g. mock → Gemini) and the transcript
 *     cache is replaying old responses.
 *   - You've changed a system prompt and want to re-classify from scratch.
 *
 * Returns the row counts that were removed, for diagnostics.
 */
export async function clearAiCache(saveId: string): Promise<{
  transcripts: number;
  sceneSpecs: number;
  textures: number;
}> {
  const transcripts = await db.transcript
    .where("[saveId+callId]")
    .between([saveId, Dexie.minKey], [saveId, Dexie.maxKey])
    .delete();
  const sceneSpecs = await db.sceneSpecs
    .where("[saveId+scope]")
    .between([saveId, Dexie.minKey], [saveId, Dexie.maxKey])
    .delete();
  const textures = await db.textures.where("saveId").equals(saveId).delete();
  return { transcripts, sceneSpecs, textures };
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
