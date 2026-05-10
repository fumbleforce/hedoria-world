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

export class VoyageDb extends Dexie {
  meta!: Table<MetaRow, string>;
  saves!: Table<SaveRow, string>;
  expansionEntities!: Table<ExpansionEntityRow, [string, string, string]>;
  transcript!: Table<TranscriptRow, [string, string]>;
  quarantine!: Table<QuarantineRow, [string, string]>;

  constructor() {
    super("voyage3d");
    this.version(1).stores({
      meta: "key",
      saves: "saveId, packId, updatedAt",
      expansionEntities: "[saveId+entityType+entityId], [saveId+entityType]",
      transcript: "[saveId+callId], [saveId+promptHash]",
      quarantine: "[saveId+quarantineId], [saveId+entityType]",
    });
  }
}

export const db = new VoyageDb();
