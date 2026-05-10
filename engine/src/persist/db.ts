import Dexie, { type Table } from "dexie";
import type { ExpansionEntityRow } from "../world/indexer";

export type SaveRow = {
  saveId: string;
  packId: string;
  bundleHash: string;
  manifestHash: string;
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

export type SceneSpecRow = {
  saveId: string;
  scope: "region" | "location" | "area";
  ids: string;
  spec: unknown;
  source: "bundle" | "llm" | "procedural" | "author";
  generatedAt: number;
};

export type TextureRow = {
  saveId: string;
  key: string;
  bytes: Uint8Array;
  mime: string;
  width: number;
  height: number;
  source: "bundle" | "llm" | "procedural";
  generatedAt: number;
};

export class VoyageDb extends Dexie {
  meta!: Table<MetaRow, string>;
  saves!: Table<SaveRow, string>;
  expansionEntities!: Table<ExpansionEntityRow, [string, string, string]>;
  transcript!: Table<TranscriptRow, [string, string]>;
  quarantine!: Table<QuarantineRow, [string, string]>;
  sceneSpecs!: Table<SceneSpecRow, [string, string, string]>;
  textures!: Table<TextureRow, [string, string]>;

  constructor() {
    super("voyage3d");
    this.version(1).stores({
      meta: "key",
      saves: "saveId, packId, updatedAt",
      expansionEntities: "[saveId+entityType+entityId], [saveId+entityType]",
      transcript: "[saveId+callId], [saveId+promptHash]",
      quarantine: "[saveId+quarantineId], [saveId+entityType]",
    });
    this.version(2).stores({
      meta: "key",
      saves: "saveId, packId, updatedAt",
      expansionEntities: "[saveId+entityType+entityId], [saveId+entityType]",
      transcript: "[saveId+callId], [saveId+promptHash]",
      quarantine: "[saveId+quarantineId], [saveId+entityType]",
      sceneSpecs: "[saveId+scope+ids], [saveId+scope]",
    });
    this.version(3).stores({
      meta: "key",
      saves: "saveId, packId, updatedAt",
      expansionEntities: "[saveId+entityType+entityId], [saveId+entityType]",
      transcript: "[saveId+callId], [saveId+promptHash]",
      quarantine: "[saveId+quarantineId], [saveId+entityType]",
      sceneSpecs: "[saveId+scope+ids], [saveId+scope]",
      textures: "[saveId+key]",
    });
  }
}

export const db = new VoyageDb();
