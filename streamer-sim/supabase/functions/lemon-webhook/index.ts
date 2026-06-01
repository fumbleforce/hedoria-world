/**
 * lemon-webhook — Supabase Edge Function
 *
 * Receives LemonSqueezy webhook events, verifies the HMAC-SHA256 signature,
 * and upserts subscription state into public.profiles.
 *
 * verify_jwt = false in config.toml — LemonSqueezy signs its own payload.
 *
 * Set these secrets before deploying:
 *   supabase secrets set LEMONSQUEEZY_WEBHOOK_SECRET=your-signing-secret
 *
 * Register the webhook in LemonSqueezy → Settings → Webhooks:
 *   URL: https://your-project-ref.supabase.co/functions/v1/lemon-webhook
 *   Events: subscription_created, subscription_updated, subscription_cancelled,
 *            subscription_expired, subscription_resumed, subscription_paused
 *
 * Pass the Supabase user ID in the checkout URL as:
 *   checkout[custom][user_id]=<uuid>
 * (see src/lib/lemonSqueezy.ts)
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const SIGNING_SECRET = Deno.env.get("LEMONSQUEEZY_WEBHOOK_SECRET") ?? "";

async function verifySignature(body: string, signature: string): Promise<boolean> {
  if (!SIGNING_SECRET || !signature) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SIGNING_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const sigBytes = new Uint8Array(
    signature.match(/.{2}/g)!.map((b) => parseInt(b, 16)),
  );
  return crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(body));
}

/** Map LemonSqueezy event + status to the values we store. */
function resolveEntitlement(
  eventName: string,
  status: string,
): { subscriptionStatus: string; tier: string } | null {
  const active = status === "active" || status === "trialing";
  switch (eventName) {
    case "subscription_created":
    case "subscription_updated":
    case "subscription_resumed":
      return { subscriptionStatus: active ? "active" : "cancelled", tier: active ? "pro" : "free" };
    case "subscription_cancelled":
    case "subscription_expired":
      return { subscriptionStatus: "cancelled", tier: "free" };
    case "subscription_paused":
      return { subscriptionStatus: "past_due", tier: "free" };
    default:
      return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const body = await req.text();
  const signature = req.headers.get("x-signature") ?? "";

  if (!(await verifySignature(body, signature))) {
    console.error("lemon-webhook: invalid signature");
    return new Response("Unauthorized", { status: 401 });
  }

  let event: {
    meta: { event_name: string; custom_data?: { user_id?: string } };
    data: { attributes: { customer_id: number; status: string; identifier?: string } };
  };

  try {
    event = JSON.parse(body);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const userId = event.meta.custom_data?.user_id;
  if (!userId) {
    console.warn("lemon-webhook: no user_id in custom_data — ignoring");
    return new Response(JSON.stringify({ ok: true, skipped: "no user_id" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const entitlement = resolveEntitlement(
    event.meta.event_name,
    event.data.attributes.status,
  );

  if (!entitlement) {
    return new Response(JSON.stringify({ ok: true, skipped: "unhandled event" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { error } = await supabase
    .from("profiles")
    .update({
      subscription_status: entitlement.subscriptionStatus,
      subscription_tier: entitlement.tier,
      ls_customer_id: String(event.data.attributes.customer_id),
      ls_subscription_id: event.data.attributes.identifier ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);

  if (error) {
    console.error("lemon-webhook: DB update failed", error.message);
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  console.log(`lemon-webhook: ${event.meta.event_name} → user ${userId} → ${entitlement.subscriptionStatus}`);
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
