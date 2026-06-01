/**
 * openrouter-proxy — Supabase Edge Function
 *
 * Production replacement for the Vite dev-server `/__openrouter/chat` proxy.
 * Requires a valid Supabase JWT (enforced by config.toml: verify_jwt = true).
 *
 * Inference is billed per user: on a signed-in user's first chat request we mint
 * a runtime OpenRouter key from OPENROUTER_PROVISIONING_KEY (monthly cap scaled
 * to their tier), store it (RLS-locked, optionally AES-GCM encrypted), and
 * forward completions with *that* key. See _shared/openrouter.ts.
 *
 * Secrets:
 *   OPENROUTER_PROVISIONING_KEY   — required for per-user keys (mint/PATCH)
 *   OPENROUTER_API_KEY            — optional; only fronts the public /models catalog
 *   KEY_ENCRYPTION_SECRET         — optional; AES-GCM at-rest encryption of keys
 *   OPENROUTER_APP_TITLE, APP_URL — optional request attribution
 *   OPENROUTER_LIMIT_FREE / _PRO  — optional monthly USD caps (default 1 / 20)
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { getUserApiKey, provisioningConfigured } from "../_shared/openrouter.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-id",
};

const OPENROUTER_CHAT = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODELS =
  "https://openrouter.ai/api/v1/models?output_modalities=text,image";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });

/** Pull the user id from the (already JWT-verified) bearer token. */
function userIdFromAuth(header: string | null): string | null {
  if (!header) return null;
  const token = header.replace(/^Bearer\s+/i, "");
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  const sharedKey = Deno.env.get("OPENROUTER_API_KEY") ?? "";
  const appTitle = Deno.env.get("OPENROUTER_APP_TITLE") ?? "Limelight";
  const appUrl = Deno.env.get("APP_URL") ?? "https://limelight.game";
  const url = new URL(req.url);

  // GET /status — health check. OK if we can serve inference at all.
  if (req.method === "GET" && url.pathname.endsWith("/status")) {
    return json({ ok: provisioningConfigured || sharedKey.length > 0 });
  }

  // GET /models — public model catalog (shared key just lifts rate limits).
  if (req.method === "GET" && url.pathname.endsWith("/models")) {
    const upstream = await fetch(OPENROUTER_MODELS, {
      headers: sharedKey ? { Authorization: `Bearer ${sharedKey}` } : {},
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

  // POST / — chat completions, billed against the caller's per-user key.
  if (req.method === "POST") {
    const userId = userIdFromAuth(req.headers.get("Authorization"));
    if (!userId) return json({ error: "no authenticated user" }, 401);

    let apiKey = "";
    try {
      if (provisioningConfigured) {
        const supabase = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );
        const { data: profile } = await supabase
          .from("profiles")
          .select("subscription_tier")
          .eq("id", userId)
          .maybeSingle();
        apiKey = await getUserApiKey(supabase, userId, profile?.subscription_tier ?? "free");
      } else {
        apiKey = sharedKey; // fallback: single shared key for everyone
      }
    } catch (e) {
      console.error("openrouter-proxy: key resolution failed", e);
      return json({ error: "could not provision an API key" }, 502);
    }

    if (!apiKey) {
      return json({ error: "OpenRouter not configured (no provisioning or shared key)" }, 503);
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
