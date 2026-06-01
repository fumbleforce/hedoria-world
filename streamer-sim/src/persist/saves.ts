import type { Settings } from "../game/types";

const SAVES_KEY = "limelight-saves";
const LEGACY_STORE_KEY = "limelight-save-v3";
const SLOT_PREFIX = "limelight-slot:";

export interface SaveSlotMeta {
  id: string;
  name: string;
  characterName: string;
  day: number;
  portraitId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface SaveIndex {
  activeId: string;
  slots: SaveSlotMeta[];
}

interface LegacySaveShape {
  settings?: Partial<Settings>;
  metrics?: { day?: number };
  character?: { portraitId?: string | null };
}

interface PersistSnapshot {
  state: { settings?: Partial<Settings> };
  version: number;
}

function now(): number {
  return Date.now();
}

function slotStorageKey(slotId: string): string {
  return `${SLOT_PREFIX}${slotId}`;
}

function makeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `slot-${Math.random().toString(36).slice(2, 11)}`;
}

function readIndexRaw(): SaveIndex | null {
  try {
    const raw = localStorage.getItem(SAVES_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SaveIndex;
    if (!parsed || typeof parsed.activeId !== "string" || !Array.isArray(parsed.slots)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeIndex(next: SaveIndex): void {
  localStorage.setItem(SAVES_KEY, JSON.stringify(next));
}

function normalize(index: SaveIndex): SaveIndex {
  const slots = index.slots.filter((s) => s && typeof s.id === "string");
  if (!slots.length) {
    const created = createSlot("Save 1");
    return { activeId: created.id, slots: [created] };
  }
  const activeExists = slots.some((s) => s.id === index.activeId);
  return { activeId: activeExists ? index.activeId : slots[0].id, slots };
}

export function loadIndex(): SaveIndex {
  const index = readIndexRaw();
  if (!index) {
    const created = createSlot("Save 1");
    const next = { activeId: created.id, slots: [created] };
    writeIndex(next);
    return next;
  }
  const next = normalize(index);
  writeIndex(next);
  return next;
}

export function saveStorageKey(slotId: string): string {
  return slotStorageKey(slotId);
}

export function getActiveSlotId(): string {
  return loadIndex().activeId;
}

export function getActiveSlot(): SaveSlotMeta {
  const index = loadIndex();
  return index.slots.find((s) => s.id === index.activeId) ?? index.slots[0];
}

/**
 * Read the current slot metadata and its Zustand persist blob from localStorage.
 * Used by cloud sync to get a snapshot without going through React state.
 */
export function getActiveSaveSnapshot(): { meta: SaveSlotMeta; state: Record<string, unknown> } | null {
  try {
    const meta = getActiveSlot();
    const raw = localStorage.getItem(saveStorageKey(meta.id));
    const state = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    return { meta, state };
  } catch {
    return null;
  }
}

export function listSlots(): SaveSlotMeta[] {
  return loadIndex().slots;
}

export function createSlot(name: string): SaveSlotMeta {
  const ts = now();
  return {
    id: makeId(),
    name,
    characterName: "Abby",
    day: 1,
    portraitId: null,
    createdAt: ts,
    updatedAt: ts,
  };
}

export function createAndActivateSlot(name: string, seedSettings?: Settings): SaveSlotMeta {
  const index = loadIndex();
  const slot = createSlot(name);
  if (seedSettings) {
    const seed: PersistSnapshot = { state: { settings: seedSettings }, version: 0 };
    localStorage.setItem(slotStorageKey(slot.id), JSON.stringify(seed));
  }
  const next: SaveIndex = { activeId: slot.id, slots: [slot, ...index.slots] };
  writeIndex(next);
  return slot;
}

export function setActiveSlot(id: string): void {
  const index = loadIndex();
  if (!index.slots.some((s) => s.id === id)) return;
  if (index.activeId === id) return;
  writeIndex({ ...index, activeId: id });
}

export function renameSlot(id: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  const index = loadIndex();
  const next = index.slots.map((s) => (s.id === id ? { ...s, name: trimmed, updatedAt: now() } : s));
  writeIndex({ ...index, slots: next });
}

export function updateActiveMeta(patch: Partial<Pick<SaveSlotMeta, "characterName" | "day" | "portraitId">>): void {
  const index = loadIndex();
  const updated = index.slots.map((s) =>
    s.id === index.activeId
      ? {
          ...s,
          characterName: patch.characterName ?? s.characterName,
          day: patch.day ?? s.day,
          portraitId: patch.portraitId === undefined ? s.portraitId : patch.portraitId,
          updatedAt: now(),
        }
      : s,
  );
  writeIndex({ ...index, slots: updated });
}

export function deleteSlot(id: string): { deleted: boolean; nextActiveId: string | null } {
  const index = loadIndex();
  if (index.slots.length <= 1) return { deleted: false, nextActiveId: index.activeId };
  if (!index.slots.some((s) => s.id === id)) return { deleted: false, nextActiveId: index.activeId };

  const nextSlots = index.slots.filter((s) => s.id !== id);
  const nextActiveId = index.activeId === id ? nextSlots[0].id : index.activeId;
  writeIndex({ activeId: nextActiveId, slots: nextSlots });
  localStorage.removeItem(slotStorageKey(id));
  return { deleted: true, nextActiveId };
}

export function migrateLegacy(): SaveSlotMeta {
  const index = readIndexRaw();
  if (index?.slots?.length) {
    const fixed = normalize(index);
    writeIndex(fixed);
    return fixed.slots.find((s) => s.id === fixed.activeId) ?? fixed.slots[0];
  }

  let legacy: LegacySaveShape = {};
  try {
    const raw = localStorage.getItem(LEGACY_STORE_KEY);
    if (raw) legacy = JSON.parse(raw) as LegacySaveShape;
  } catch {
    legacy = {};
  }

  const name = (legacy.settings?.streamerName ?? "").trim() || "Save 1";
  const slot = createSlot(name);
  slot.characterName = name;
  slot.day = Math.max(1, Math.round(legacy.metrics?.day ?? 1));
  slot.portraitId = legacy.character?.portraitId ?? null;
  slot.updatedAt = now();

  if (localStorage.getItem(LEGACY_STORE_KEY)) {
    localStorage.setItem(slotStorageKey(slot.id), localStorage.getItem(LEGACY_STORE_KEY) ?? "");
    localStorage.removeItem(LEGACY_STORE_KEY);
  }
  writeIndex({ activeId: slot.id, slots: [slot] });
  return slot;
}
