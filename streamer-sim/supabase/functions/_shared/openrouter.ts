/**
 * _shared/openrouter.ts — per-user OpenRouter key provisioning + at-rest crypto.
 *
 * Shared by openrouter-proxy (mint/lookup at request time) and lemon-webhook
 * (re-limit on tier change). The shared OPENROUTER_API_KEY is no longer the
 * thing that bills inference — it only fronts the public model catalog. Each
 * signed-in user gets their own runtime key minted from the provisioning
 * (management) key, with a monthly spend cap scaled to their tier.
 *
 * Required secret:
 *   OPENROUTER_PROVISIONING_KEY   — management key from the OpenRouter dashboard
 *
 * Optional secrets:
 *   KEY_ENCRYPTION_SECRET         — enables AES-GCM at-rest encryption of stored
 *                                   runtime keys. If unset, keys are stored as
 *                                   plaintext (still RLS-protected, service-role
 *                                   only) and tagged so they keep decrypting if
 *                                   you set the secret later.
 *   OPENROUTER_LIMIT_FREE         — monthly USD cap for free tier (default 1)
 *   OPENROUTER_LIMIT_PRO          — monthly USD cap for pro tier  (default 20)
 */

const PROVISIONING_KEY = Deno.env.get("OPENROUTER_PROVISIONING_KEY") ?? "";
const ENC_SECRET = Deno.env.get("KEY_ENCRYPTION_SECRET") ?? "";
const KEYS_ENDPOINT = "https://openrouter.ai/api/v1/keys";

export const provisioningConfigured = PROVISIONING_KEY.length > 0;

/** Monthly USD spend cap for a given subscription tier. */
export function limitForTier(tier: string | null | undefined): number {
  if (tier === "pro") return Number(Deno.env.get("OPENROUTER_LIMIT_PRO") ?? "20");
  return Number(Deno.env.get("OPENROUTER_LIMIT_FREE") ?? "1");
}

// ── At-rest encryption (AES-GCM, key derived from KEY_ENCRYPTION_SECRET) ──────

async function aesKey(): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ENC_SECRET));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/** Encrypt a runtime key for storage. Tagged so reads stay self-describing. */
export async function encryptSecret(plain: string): Promise<string> {
  if (!ENC_SECRET) return `plain:${plain}`;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await aesKey(),
    new TextEncoder().encode(plain),
  );
  const packed = new Uint8Array(iv.length + ct.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(ct), iv.length);
  return `enc:v1:${btoa(String.fromCharCode(...packed))}`;
}

/** Decrypt a stored runtime key, honouring the storage tag. */
export async function decryptSecret(stored: string): Promise<string> {
  if (stored.startsWith("plain:")) return stored.slice("plain:".length);
  if (stored.startsWith("enc:v1:")) {
    if (!ENC_SECRET) throw new Error("KEY_ENCRYPTION_SECRET not set but a stored key is encrypted");
    const raw = Uint8Array.from(atob(stored.slice("enc:v1:".length)), (c) => c.charCodeAt(0));
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: raw.slice(0, 12) },
      await aesKey(),
      raw.slice(12),
    );
    return new TextDecoder().decode(pt);
  }
  return stored; // untagged legacy value
}

// ── Provisioning API ─────────────────────────────────────────────────────────

/** Mint a fresh runtime key with a monthly cap. Returns secret (shown once) + hash. */
export async function provisionKey(name: string, limit: number): Promise<{ key: string; hash: string }> {
  const res = await fetch(KEYS_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${PROVISIONING_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, limit, limit_reset: "monthly" }),
  });
  if (!res.ok) throw new Error(`provision failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  const hash = json?.data?.hash ?? json?.hash;
  const key = json?.key;
  if (!key || !hash) throw new Error("provision response missing key/hash");
  return { key, hash };
}

/** Re-cap an existing runtime key (called on tier change). */
export async function updateKeyLimit(hash: string, limit: number): Promise<void> {
  const res = await fetch(`${KEYS_ENDPOINT}/${hash}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${PROVISIONING_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ limit }),
  });
  if (!res.ok) throw new Error(`update failed: ${res.status} ${await res.text()}`);
}

/**
 * Look up the caller's runtime key, minting (and storing) one on first use.
 * `supabase` must be a service-role client so it can read/write the
 * RLS-locked user_openrouter_keys table.
 */
export async function getUserApiKey(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string,
  tier: string,
): Promise<string> {
  const { data: row } = await supabase
    .from("user_openrouter_keys")
    .select("encrypted_key")
    .eq("user_id", userId)
    .maybeSingle();

  if (row?.encrypted_key) return decryptSecret(row.encrypted_key);

  const { key, hash } = await provisionKey(`limelight:${userId}`, limitForTier(tier));
  const encrypted_key = await encryptSecret(key);
  const { error } = await supabase
    .from("user_openrouter_keys")
    .insert({ user_id: userId, key_hash: hash, encrypted_key });
  if (error) throw new Error(`store user key failed: ${error.message}`);
  return key;
}
