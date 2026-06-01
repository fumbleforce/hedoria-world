/**
 * openrouter-proxy — Supabase Edge Function
 *
 * Production replacement for the Vite dev-server `/__openrouter/chat` proxy.
 * Holds the OPENROUTER_API_KEY secret server-side; requires a valid Supabase
 * JWT (enforced by supabase/config.toml: verify_jwt = true).
 *
 * Set these secrets before deploying:
 *   supabase secrets set OPENROUTER_API_KEY=sk-or-v1-...
 *   supabase secrets set OPENROUTER_APP_TITLE=Limelight
 *   supabase secrets set APP_URL=https://yourdomain.com
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const OPENROUTER_CHAT = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODELS =
  "https://openrouter.ai/api/v1/models?output_modalities=text,image";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  const apiKey = Deno.env.get("OPENROUTER_API_KEY") ?? "";
  const appTitle = Deno.env.get("OPENROUTER_APP_TITLE") ?? "Limelight";
  const appUrl = Deno.env.get("APP_URL") ?? "https://limelight.game";

  const url = new URL(req.url);

  // GET /openrouter-proxy/status — health check (JWT still required)
  if (req.method === "GET" && url.pathname.endsWith("/status")) {
    return new Response(JSON.stringify({ ok: apiKey.length > 0 }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // GET /openrouter-proxy/models — forward model catalog
  if (req.method === "GET" && url.pathname.endsWith("/models")) {
    const upstream = await fetch(OPENROUTER_MODELS, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    });
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": upstream.headers.get("content-type") ?? "application/json",
        "Cache-Control": "no-store",
      },
    });
  }

  // POST /openrouter-proxy — chat completions (main path)
  if (req.method === "POST") {
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "OPENROUTER_API_KEY not configured" }), {
        status: 503,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const body = await req.text();
    const upstream = await fetch(OPENROUTER_CHAT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "X-Title": appTitle,
        "HTTP-Referer": appUrl,
      },
      body,
    });

    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": upstream.headers.get("content-type") ?? "application/json",
      },
    });
  }

  return new Response("Not Found", { status: 404, headers: CORS_HEADERS });
});
