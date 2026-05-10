import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage } from "node:http";

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

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
          const body = await readBody(req);
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

/**
 * Dev-only LLM transcript sink. The browser POSTs one JSON line per LLM call
 * (system prompt, messages, response, model, timing) and we append it as
 * JSONL to `engine/logs/llm-prompts.jsonl`. Useful for prompt engineering and
 * debugging — `tail -f engine/logs/llm-prompts.jsonl | jq` is your friend.
 *
 * Endpoint is unauthenticated; only available when running `vite` (dev mode).
 * Production builds simply 404 the call, which the client swallows.
 */
function llmLogEndpoint(): Plugin {
  return {
    name: "llm-log-endpoint",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.method !== "POST" || req.url !== "/__llm-log") {
          next();
          return;
        }
        try {
          const body = await readBody(req);
          const logDir = path.resolve(__dirname, "logs");
          await fs.mkdir(logDir, { recursive: true });
          const file = path.resolve(logDir, "llm-prompts.jsonl");
          // Defensive: ensure the body is a single line of JSON, never multi-line,
          // so the JSONL invariant holds even if the client passed pretty-printed
          // payload by accident.
          let line: string;
          try {
            line = JSON.stringify(JSON.parse(body));
          } catch {
            line = JSON.stringify({ raw: body });
          }
          await fs.appendFile(file, line + "\n");
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
  plugins: [react(), promotionEndpoint(), llmLogEndpoint()],
});
