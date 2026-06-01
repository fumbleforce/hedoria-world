import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const rawUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ?? "";
const rawKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() ?? "";

export const supabaseConfigured = rawUrl.length > 0 && rawKey.length > 0;

/**
 * Shared Supabase browser client.
 *
 * When VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are absent (local dev without
 * Supabase), the client is created with inert placeholder values so the module
 * loads without throwing. All callers gate on `supabaseConfigured` before making
 * any actual requests.
 */
export const supabase = createClient<Database>(
  rawUrl || "https://placeholder.supabase.co",
  rawKey || "placeholder",
  supabaseConfigured
    ? undefined
    : { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } },
);
