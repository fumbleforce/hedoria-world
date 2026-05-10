import Dexie, { type Table } from "dexie";
import type { ExpansionEntityRow } from "../world/indexer";

/**
 * One save row per save slot. Without a pack abstraction there's no need to
 * record bundle/manifest hashes — `configHash` is a rolling hash of the
 * config.json that produced this save, used purely so the DB inspector can
 * surface "is this save against current canon?". Save invalidation is opt-in
 * (the player triggers "reset AI cache"), not driven by the hash changing.
 */
export type SaveRow = {
  saveId: string;
  configHash: string;
  seed: string;
  playerState: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
};

export type TranscriptRow = {
  saveId: string;
  callId: string;
  promptHash: string;
  model: string;
  prompt: string;
  response: string;
  generatedAt: number;
};

export type QuarantineRow = {
  saveId: string;
  quarantineId: string;
  entityType: string;
  attemptedData: unknown;
  diagnostics: string[];
  failedAt: number;
};

export type MetaRow = {
  key: string;
  value: unknown;
};

/**
 * Generic LLM-output cache row. Scopes:
 *  - `tile-grid`: the full grid for a region or a location. `ids` = regionId
 *    or locationId. `spec` = TileGrid object (see grid/tilePrimitives.ts).
 *  - `image-prompt`: the per-kind image-prompt sentence the LLM produced
 *    once per (kind, biome) and we reuse for image generation. `ids` =
 *    `${kind}::${biome}`. `spec` = `{ prompt: string }`.
 *  - `narration`: cached narration for replays of the same scene state.
 *    `ids` = scene state hash. `spec` = `{ text: string }`.
 *  - `region` | `location` | `area`: legacy 3D engine slots; preserved for
 *    backwards compatibility but not used by the 2D engine.
 */
export type SceneSpecRow = {
  saveId: string;
  scope:
    | "tile-grid"
    | "image-prompt"
    | "narration"
    | "region"
    | "location"
    | "area";
  ids: string;
  spec: unknown;
  source: "llm" | "procedural" | "author";
  generatedAt: number;
};

/**
 * Rendered tile illustration bytes. Keyed by `key = sha1(kind + biome + style)`
 * so the same kind always reuses the same image regardless of which region
 * it appears in (a "reed-marsh" looks the same whether it's in Avenor or
 * Whitestone Coast — that's the whole point of the kind palette).
 */
export type TileImageRow = {
  saveId: string;
  key: string;
  bytes: Uint8Array;
  mime: string;
  width: number;
  height: number;
  source: "llm" | "procedural";
  generatedAt: number;
};

export class WorldPuppeteerDb extends Dexie {
  meta!: Table<MetaRow, string>;
  saves!: Table<SaveRow, string>;
  expansionEntities!: Table<ExpansionEntityRow, [string, string, string]>;
  transcript!: Table<TranscriptRow, [string, string]>;
  quarantine!: Table<QuarantineRow, [string, string]>;
  sceneSpecs!: Table<SceneSpecRow, [string, string, string]>;
  tileImages!: Table<TileImageRow, [string, string]>;

  constructor() {
    super("world-puppeteer");
    this.version(1).stores({
      meta: "key",
      saves: "saveId, updatedAt",
      expansionEntities: "[saveId+entityType+entityId], [saveId+entityType]",
      transcript: "[saveId+callId], [saveId+promptHash]",
      quarantine: "[saveId+quarantineId], [saveId+entityType]",
      sceneSpecs: "[saveId+scope+ids], [saveId+scope]",
      tileImages: "[saveId+key]",
    });
  }
}

export const db = new WorldPuppeteerDb();
