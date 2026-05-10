export type PromotionEntry = {
  entityType: string;
  entityId: string;
  data: Record<string, unknown>;
};

export interface PromotionWriter {
  writeCandidates(packId: string, entries: PromotionEntry[]): Promise<void>;
}

export class DevServerWriter implements PromotionWriter {
  async writeCandidates(packId: string, entries: PromotionEntry[]): Promise<void> {
    const response = await fetch("/__promote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packId, entries }),
    });
    if (!response.ok) {
      throw new Error(`Promotion failed (${response.status})`);
    }
  }
}

export class DownloadBlobWriter implements PromotionWriter {
  async writeCandidates(packId: string, entries: PromotionEntry[]): Promise<void> {
    const blob = new Blob([JSON.stringify({ packId, entries }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${packId}-promotion.json`;
    link.click();
    URL.revokeObjectURL(url);
  }
}
