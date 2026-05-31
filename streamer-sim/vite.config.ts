import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage } from "node:http";

/**
 * Dev-server glue (patterns ported/trimmed from the Hedoria engine):
 *  - /__llm-log   : append every LLM call to logs/llm-prompts.jsonl for prompt tuning.
 *  - /__diag-log  : echo each diag record to the terminal + append logs/events.jsonl.
 *  - /__openrouter/* : CORS-safe proxy so the browser can hit OpenRouter without
 *    exposing the API key (read via loadEnv, never VITE_-prefixed).
 *
 * All are dev-only; production builds 404 them and the client swallows the error.
 */

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

/**
 * LLM call sink. Writes TWO files:
 *   - logs/llm-prompts.jsonl : one machine-readable JSON line per call.
 *   - logs/llm-debug.log     : a human-readable, full transcript (system prompt,
 *                              every message, and the raw response) for debugging
 *                              exactly what the model saw and said.
 */
function llmLogEndpoint(): Plugin {
  const jsonl = path.resolve(__dirname, "logs", "llm-prompts.jsonl");
  const debug = path.resolve(__dirname, "logs", "llm-debug.log");
  return {
    name: "llm-log-endpoint",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.method !== "POST" || req.url !== "/__llm-log") return next();
        try {
          const body = await readBody(req);
          await fs.mkdir(path.dirname(jsonl), { recursive: true });
          let rec: Record<string, unknown> | null = null;
          try {
            rec = JSON.parse(body) as Record<string, unknown>;
          } catch {
            rec = null;
          }
          await fs.appendFile(jsonl, (rec ? JSON.stringify(rec) : JSON.stringify({ raw: body })) + "\n");
          if (rec) await fs.appendFile(debug, formatDebug(rec));
          res.statusCode = 200;
          res.end(JSON.stringify({ ok: true }));
        } catch (error) {
          res.statusCode = 500;
          res.end(JSON.stringify({ ok: false, error: String(error) }));
        }
      });
    },
  };
}

function formatDebug(rec: Record<string, unknown>): string {
  const ts = String(rec.ts ?? "");
  const kind = String(rec.kind ?? "?");
  const model = String(rec.model ?? "?");
  const ms = rec.durationMs != null ? `${rec.durationMs}ms` : "";
  const req = (rec.request ?? {}) as { system?: string; messages?: Array<{ role?: string; content?: string }>; jsonMode?: boolean };
  const resp = (rec.response ?? {}) as { text?: string };
  const lines: string[] = [];
  lines.push(`\n${"=".repeat(90)}`);
  lines.push(`${ts}  [${kind}]  ${model}  ${ms}  jsonMode=${req.jsonMode ?? false}`);
  lines.push("-".repeat(90));
  lines.push("SYSTEM:");
  lines.push(req.system ?? "(none)");
  lines.push("-".repeat(90));
  lines.push("MESSAGES:");
  for (const m of req.messages ?? []) {
    lines.push(`  [${m.role}] ${m.content}`);
  }
  lines.push("-".repeat(90));
  lines.push("RESPONSE:");
  lines.push(resp.text ?? "(empty)");
  lines.push("");
  return lines.join("\n");
}

const LEVEL_TAG: Record<string, string> = {
  debug: "·",
  info: "ℹ",
  warn: "⚠",
  error: "✖",
};

/**
 * Dev-only diagnostics sink. The browser POSTs one JSON record per diag call;
 * we echo a compact, readable line to the Vite terminal AND append the full
 * record as JSONL to logs/events.jsonl. So `npm run dev` shows the live game
 * flow in the terminal, and you can `tail -f` / jq the file for detail.
 */
function diagLogEndpoint(): Plugin {
  const file = path.resolve(__dirname, "logs", "events.jsonl");
  return {
    name: "diag-log-endpoint",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.method !== "POST" || req.url !== "/__diag-log") return next();
        try {
          const body = await readBody(req);
          await fs.mkdir(path.dirname(file), { recursive: true });
          let rec: Record<string, unknown> = {};
          try {
            rec = JSON.parse(body) as Record<string, unknown>;
          } catch {
            rec = { raw: body };
          }
          await fs.appendFile(file, JSON.stringify(rec) + "\n");
          const level = String(rec.level ?? "info");
          const channel = String(rec.channel ?? "?").padEnd(9);
          const tag = LEVEL_TAG[level] ?? "·";
          const data =
            rec.data && Object.keys(rec.data as object).length
              ? " " + JSON.stringify(rec.data)
              : "";
          // eslint-disable-next-line no-console
          console.log(`  ${tag} [${channel}] ${String(rec.message ?? "")}${data}`);
          res.statusCode = 200;
          res.end(JSON.stringify({ ok: true }));
        } catch (error) {
          res.statusCode = 500;
          res.end(JSON.stringify({ ok: false, error: String(error) }));
        }
      });
    },
  };
}

const OPENROUTER_UPSTREAM = "https://openrouter.ai/api/v1/chat/completions";
// NOTE: /models defaults to output_modalities=text, which hides pure image
// generators (Seedream, Flux…). Ask for both so image-only models show up.
const OPENROUTER_MODELS_UPSTREAM =
  "https://openrouter.ai/api/v1/models?output_modalities=text,image";

function openRouterProxyEndpoint(): Plugin {
  return {
    name: "openrouter-proxy-endpoint",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url) return next();
        const env = loadEnv(server.config.mode, process.cwd(), "");
        const apiKey = env.OPENROUTER_API_KEY?.trim() ?? "";
        const title = env.OPENROUTER_APP_TITLE?.trim() ?? "Limelight";
        const route = req.url.split("?")[0];

        if (req.method === "GET" && route === "/__openrouter/status") {
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "no-store");
          res.end(JSON.stringify({ ok: apiKey.length > 0 }));
          return;
        }

        if (req.method === "GET" && route === "/__openrouter/models") {
          const reqId = (req.headers["x-request-id"] as string | undefined) ?? "or-models";
          const startedAt = Date.now();
          try {
            const upstream = await fetch(OPENROUTER_MODELS_UPSTREAM, {
              headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
            });
            const text = await upstream.text();
            res.statusCode = upstream.status;
            res.setHeader(
              "Content-Type",
              upstream.headers.get("content-type") ?? "application/json",
            );
            res.setHeader("Cache-Control", "no-store");
            res.end(text);
            // eslint-disable-next-line no-console
            console.log(
              `[openrouter] ${reqId} ← ${upstream.status} models (${text.length}B, ${Date.now() - startedAt}ms)`,
            );
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            // eslint-disable-next-line no-console
            console.error(`[openrouter] ${reqId} ✖ models failed: ${msg}`);
            res.statusCode = 502;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: false, error: msg }));
          }
          return;
        }

        if (req.method === "POST" && route === "/__openrouter/chat") {
          if (!apiKey) {
            res.statusCode = 503;
            res.end(JSON.stringify({ ok: false, error: "OPENROUTER_API_KEY not set (.env.local)" }));
            return;
          }
          try {
            const body = await readBody(req);
            const upstream = await fetch(OPENROUTER_UPSTREAM, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
                "X-Title": title,
              },
              body,
            });
            const text = await upstream.text();
            res.statusCode = upstream.status;
            res.setHeader(
              "Content-Type",
              upstream.headers.get("content-type") ?? "application/json",
            );
            res.end(text);
          } catch (error) {
            res.statusCode = 502;
            res.end(JSON.stringify({ ok: false, error: String(error) }));
          }
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), llmLogEndpoint(), diagLogEndpoint(), openRouterProxyEndpoint()],
});
