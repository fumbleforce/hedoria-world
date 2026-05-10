import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs/promises";
import path from "node:path";

function promotionEndpoint(): Plugin {
  return {
    name: "promotion-endpoint",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.method !== "POST" || req.url !== "/__promote") {
          next();
          return;
        }
        try {
          const body = await new Promise<string>((resolve, reject) => {
            let data = "";
            req.on("data", (chunk) => {
              data += chunk;
            });
            req.on("end", () => resolve(data));
            req.on("error", reject);
          });
          const parsed = JSON.parse(body) as {
            packId: string;
            entries: Array<{ entityType: string; entityId: string; data: Record<string, unknown> }>;
          };

          const outputRoot = path.resolve(__dirname, "..", "packs", parsed.packId, "candidates");
          await fs.mkdir(outputRoot, { recursive: true });
          const grouped = new Map<string, Record<string, unknown>>();
          for (const entry of parsed.entries) {
            const bucket = grouped.get(entry.entityType) ?? {};
            bucket[entry.entityId] = entry.data;
            grouped.set(entry.entityType, bucket);
          }

          for (const [entityType, block] of grouped.entries()) {
            const filePath = path.resolve(outputRoot, `${entityType}.json`);
            await fs.writeFile(filePath, JSON.stringify(block, null, 2));
          }

          res.statusCode = 200;
          res.end(JSON.stringify({ ok: true }));
        } catch (error) {
          res.statusCode = 500;
          res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
        }
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), promotionEndpoint()],
});
