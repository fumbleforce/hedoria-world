import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? "";

/**
 * Shared Supabase browser client.
 * Returns a no-op stub when env vars are absent (dev without Supabase, offline play).
 */
export const supabase = createClient<Database>(url, key);

export const supabaseConfigured = url.length > 0 && key.length > 0;
