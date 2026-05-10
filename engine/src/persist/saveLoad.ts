import Dexie from "dexie";
import { db, type SaveRow, type TranscriptRow } from "./db";
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
