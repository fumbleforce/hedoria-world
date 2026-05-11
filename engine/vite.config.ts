import { defineConfig, loadEnv, type Plugin } from "vite";
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

/**
 * Generic JSONL sink. Used by two endpoints below — one for raw LLM
 * prompt/response pairs (large, churns fast), one for the higher-level
 * "what's happening in the engine right now" event stream. Keeping them
 * in separate files means you can `tail -F engine/logs/events.jsonl` for
 * an at-a-glance flow without the LLM bodies drowning everything else.
 */
async function appendJsonl(file: string, body: string): Promise<void> {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  let line: string;
  try {
    line = JSON.stringify(JSON.parse(body));
  } catch {
    line = JSON.stringify({ raw: body });
  }
  await fs.appendFile(file, line + "\n");
}

function makeJsonlEndpoint(opts: { name: string; url: string; file: string }): Plugin {
  return {
    name: opts.name,
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.method !== "POST" || req.url !== opts.url) {
          next();
          return;
        }
        try {
          const body = await readBody(req);
          await appendJsonl(opts.file, body);
          res.statusCode = 200;
          res.end(JSON.stringify({ ok: true }));
        } catch (error) {
          res.statusCode = 500;
          res.end(
            JSON.stringify({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
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
  return makeJsonlEndpoint({
    name: "llm-log-endpoint",
    url: "/__llm-log",
    file: path.resolve(__dirname, "logs", "llm-prompts.jsonl"),
  });
}

/**
 * Dev-only structured event sink. Every interesting engine event (boot
 * stages, tile-grid cache hits/misses, image generation requests, narrator
 * tool dispatches, scene-runner state) lands here as one JSON line. The
 * accompanying `diag` client in `src/diag/log.ts` keeps these compact —
 * each event references the larger LLM transcript by `promptHash` so the
 * two files compose without duplicating the bulk content.
 *
 *   tail -F engine/logs/events.jsonl | jq -c '{ts,channel,level,message}'
 */
function diagLogEndpoint(): Plugin {
  return makeJsonlEndpoint({
    name: "diag-log-endpoint",
    url: "/__diag-log",
    file: path.resolve(__dirname, "logs", "events.jsonl"),
  });
}

const OPENROUTER_UPSTREAM = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODELS_UPSTREAM = "https://openrouter.ai/api/v1/models";

function pickModelFromBody(body: string): string {
  try {
    const parsed = JSON.parse(body) as { model?: unknown };
    if (typeof parsed.model === "string") return parsed.model;
  } catch {
    // body wasn't JSON — fall through and report unknown
  }
  return "<unknown>";
}

/**
 * Dev-only proxy to OpenRouter (CORS-safe). The browser POSTs an OpenAI-shaped
 * chat body; the key stays in OPENROUTER_API_KEY (loaded via loadEnv, not VITE_*).
 *
 * Every chat-completion proxy hit is logged to the server console with the
 * client-supplied X-Request-Id so you can correlate browser-side logs with the
 * upstream HTTP timing.
 */
function openRouterProxyEndpoint(): Plugin {
  return {
    name: "openrouter-proxy-endpoint",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url) {
          next();
          return;
        }
        const mode = server.config.mode;
        const env = loadEnv(mode, process.cwd(), "");
        const apiKey = env.OPENROUTER_API_KEY?.trim() ?? "";
        const referer = env.OPENROUTER_HTTP_REFERER?.trim();
        const title = env.OPENROUTER_APP_TITLE?.trim() ?? "Hedoria Engine";

        if (req.method === "GET" && req.url.split("?")[0] === "/__openrouter/status") {
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "no-store");
          res.end(JSON.stringify({ ok: apiKey.length > 0 }));
          return;
        }

        // Proxy the public model catalog. No auth needed upstream, but routing
        // through Vite avoids any CORS surprises and keeps a single base URL on
        // the client.
        if (req.method === "GET" && req.url.split("?")[0] === "/__openrouter/models") {
          const reqId = (req.headers["x-request-id"] as string | undefined) ?? "or-models";
          const startedAt = Date.now();
          console.log(`[openrouter] ${reqId} → GET ${OPENROUTER_MODELS_UPSTREAM}`);
          try {
            const upstream = await fetch(OPENROUTER_MODELS_UPSTREAM, {
              headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
            });
            const text = await upstream.text();
            const elapsed = Date.now() - startedAt;
            console.log(
              `[openrouter] ${reqId} ← ${upstream.status} models (${text.length}B, ${elapsed}ms)`,
            );
            res.statusCode = upstream.status;
            res.setHeader(
              "Content-Type",
              upstream.headers.get("content-type") ?? "application/json",
            );
            res.setHeader("Cache-Control", "no-store");
            res.end(text);
          } catch (error) {
            const elapsed = Date.now() - startedAt;
            const msg = error instanceof Error ? error.message : String(error);
            console.error(`[openrouter] ${reqId} ✖ models failed (${elapsed}ms): ${msg}`);
            res.statusCode = 502;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: false, error: msg }));
          }
          return;
        }

        if (req.method === "POST" && req.url.split("?")[0] === "/__openrouter/chat") {
          const reqId = (req.headers["x-request-id"] as string | undefined) ?? "or-chat";
          const startedAt = Date.now();
          if (!apiKey) {
            console.warn(
              `[openrouter] ${reqId} ✖ chat blocked: OPENROUTER_API_KEY missing`,
            );
            res.statusCode = 503;
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                ok: false,
                error: "OPENROUTER_API_KEY is not set (engine/.env.local)",
              }),
            );
            return;
          }
          let body = "";
          // Cancel the upstream OpenRouter call when the browser disconnects
          // (tab closed, AbortController fired client-side, navigation, etc.)
          // so we do not keep paying for a long-running image render that
          // nobody will read.
          //
          // We listen on `res.close` — that event fires both for a normal
          // response end AND for an early disconnect; we distinguish the two
          // by checking `res.writableEnded`. Listening on `req.close` would
          // be wrong: Node emits it as soon as `readBody` finishes consuming
          // the POST body, which would abort every request immediately.
          const upstreamCtl = new AbortController();
          const onResClose = () => {
            if (res.writableEnded || upstreamCtl.signal.aborted) return;
            const elapsed = Date.now() - startedAt;
            console.warn(
              `[openrouter] ${reqId} ⚠ client disconnected after ${elapsed}ms; aborting upstream`,
            );
            upstreamCtl.abort();
          };
          res.once("close", onResClose);

          // Periodic "still waiting" heartbeat so a stalled upstream is
          // visible in the dev-server log. Stops as soon as the upstream
          // fetch resolves OR the client aborts.
          const heartbeat = setInterval(() => {
            const elapsed = Date.now() - startedAt;
            console.log(
              `[openrouter] ${reqId} … still pending upstream (${elapsed}ms)`,
            );
          }, 10_000);
          try {
            body = await readBody(req);
            const model = pickModelFromBody(body);
            console.log(
              `[openrouter] ${reqId} → POST chat model=${model} body=${body.length}B`,
            );
            const upstream = await fetch(OPENROUTER_UPSTREAM, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
                ...(referer ? { Referer: referer } : {}),
                "X-Title": title,
              },
              body,
              signal: upstreamCtl.signal,
            });
            const headerMs = Date.now() - startedAt;
            const text = await upstream.text();
            const totalMs = Date.now() - startedAt;
            console.log(
              `[openrouter] ${reqId} ← ${upstream.status} chat model=${model} headers=${headerMs}ms total=${totalMs}ms body=${text.length}B`,
            );
            if (!upstream.ok) {
              const preview = text.slice(0, 400).replace(/\s+/gu, " ");
              console.warn(`[openrouter] ${reqId} body-preview: ${preview}`);
            }
            if (!res.writableEnded) {
              res.statusCode = upstream.status;
              res.setHeader(
                "Content-Type",
                upstream.headers.get("content-type") ?? "application/json",
              );
              res.end(text);
            }
          } catch (error) {
            const elapsed = Date.now() - startedAt;
            const msg = error instanceof Error ? error.message : String(error);
            const model = body ? pickModelFromBody(body) : "<unknown>";
            const aborted =
              (error as { name?: string })?.name === "AbortError" ||
              upstreamCtl.signal.aborted;
            if (aborted) {
              console.warn(
                `[openrouter] ${reqId} ⌀ aborted model=${model} after ${elapsed}ms`,
              );
            } else {
              console.error(
                `[openrouter] ${reqId} ✖ chat failed model=${model} after ${elapsed}ms: ${msg}`,
              );
            }
            if (!res.writableEnded) {
              res.statusCode = aborted ? 499 : 502;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ ok: false, error: msg }));
            }
          } finally {
            clearInterval(heartbeat);
            res.off("close", onResClose);
          }
          return;
        }

        next();
      });
    },
  };
}

/**
 * Pack discovery + serving. Each `packs/<id>/manifest.json` declares a
 * `sourceConfig` path (relative to the manifest) that points at the actual
 * authored world file. Two endpoints expose this to the client:
 *
 *   GET /__packs            -> [{ packId, packName, schemaVersion, seed }]
 *   GET /__pack/<packId>    -> the resolved source-config JSON for that pack
 *
 * Reading happens on every request so editing a pack's source file
 * hot-updates the engine on the next reload without a server restart.
 *
 * For backward compatibility (and dev convenience) we keep `/config.json`
 * working: it resolves through the `hedoria` pack manifest if available,
 * otherwise falls back to the repo-root `config.json` directly.
 */
type Manifest = {
  packId: string;
  packName?: string;
  schemaVersion?: string;
  engineCompatibility?: string;
  seed?: string;
  sourceConfig: string;
};

const PACKS_ROOT = path.resolve(__dirname, "..", "packs");

async function readManifest(packId: string): Promise<{
  manifest: Manifest;
  manifestDir: string;
} | null> {
  try {
    const manifestDir = path.join(PACKS_ROOT, packId);
    const manifestPath = path.join(manifestDir, "manifest.json");
    const raw = await fs.readFile(manifestPath, "utf8");
    const manifest = JSON.parse(raw) as Manifest;
    if (typeof manifest?.packId !== "string" || typeof manifest?.sourceConfig !== "string") {
      return null;
    }
    return { manifest, manifestDir };
  } catch {
    return null;
  }
}

async function listPackIds(): Promise<string[]> {
  try {
    const entries = await fs.readdir(PACKS_ROOT, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

function packsEndpoint(): Plugin {
  return {
    name: "packs-endpoint",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.method !== "GET" || !req.url) {
          next();
          return;
        }

        // List manifests for every directory under /packs.
        if (req.url === "/__packs") {
          try {
            const ids = await listPackIds();
            const summaries = [];
            for (const id of ids) {
              const found = await readManifest(id);
              if (!found) continue;
              const { manifest } = found;
              summaries.push({
                packId: manifest.packId,
                packName: manifest.packName ?? manifest.packId,
                schemaVersion: manifest.schemaVersion ?? null,
                engineCompatibility: manifest.engineCompatibility ?? null,
                seed: manifest.seed ?? null,
              });
            }
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Cache-Control", "no-store");
            res.end(JSON.stringify({ packs: summaries }));
          } catch (error) {
            res.statusCode = 500;
            res.end(
              JSON.stringify({
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              }),
            );
          }
          return;
        }

        // Serve the resolved source-config JSON for a specific pack.
        const packMatch = req.url.match(/^\/__pack\/([^/?#]+)(?:\?.*)?$/);
        if (packMatch) {
          const packId = decodeURIComponent(packMatch[1]);
          const found = await readManifest(packId);
          if (!found) {
            res.statusCode = 404;
            res.end(JSON.stringify({ ok: false, error: `pack not found: ${packId}` }));
            return;
          }
          const { manifest, manifestDir } = found;
          // sourceConfig is resolved relative to the manifest file. Reject
          // anything that escapes the repo root just to be safe.
          const sourcePath = path.resolve(manifestDir, manifest.sourceConfig);
          const repoRoot = path.resolve(__dirname, "..");
          if (!sourcePath.startsWith(repoRoot + path.sep)) {
            res.statusCode = 400;
            res.end(
              JSON.stringify({
                ok: false,
                error: `pack ${packId} sourceConfig escapes repo root`,
              }),
            );
            return;
          }
          try {
            const body = await fs.readFile(sourcePath, "utf8");
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Cache-Control", "no-store");
            res.end(body);
          } catch (error) {
            res.statusCode = 500;
            res.end(
              JSON.stringify({
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              }),
            );
          }
          return;
        }

        // Backward-compat: keep /config.json pointing at the hedoria pack
        // (or the repo-root config.json as a last resort).
        if (req.url === "/config.json") {
          try {
            const hedoria = await readManifest("hedoria");
            const file = hedoria
              ? path.resolve(hedoria.manifestDir, hedoria.manifest.sourceConfig)
              : path.resolve(__dirname, "..", "config.json");
            const body = await fs.readFile(file, "utf8");
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Cache-Control", "no-store");
            res.end(body);
          } catch (error) {
            res.statusCode = 500;
            res.end(
              JSON.stringify({
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              }),
            );
          }
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    llmLogEndpoint(),
    diagLogEndpoint(),
    openRouterProxyEndpoint(),
    packsEndpoint(),
  ],
});
