/**
 * Cloud save utilities — push and pull the Zustand persist blob to/from Supabase.
 *
 * These are intentionally thin wrappers. Call them from auth event handlers
 * (on login: pull, on periodic save: push). They are no-ops when Supabase is
 * not configured or the user is not signed in.
 *
 * The local localStorage + IndexedDB layer remains the primary store; Supabase
 * is the cross-device backup.
 */

import { supabase, supabaseConfigured } from "../lib/supabase";
import type { User } from "@supabase/supabase-js";
import type { SaveSlotMeta } from "./saves";

export async function pushSave(
  user: User,
  slotMeta: SaveSlotMeta,
  stateJson: Record<string, unknown>,
): Promise<void> {
  if (!supabaseConfigured) return;
  const { error } = await supabase.from("saves").upsert(
    {
      user_id: user.id,
      slot_id: slotMeta.id,
      slot_name: slotMeta.name,
      state_json: stateJson,
      character_name: slotMeta.characterName,
      day: slotMeta.day,
      portrait_id: slotMeta.portraitId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,slot_id" },
  );
  if (error) console.error("[cloudSave] push failed:", error.message);
}

export async function pullSave(
  user: User,
  slotId: string,
): Promise<Record<string, unknown> | null> {
  if (!supabaseConfigured) return null;
  const { data, error } = await supabase
    .from("saves")
    .select("state_json")
    .eq("user_id", user.id)
    .eq("slot_id", slotId)
    .single();
  if (error && error.code !== "PGRST116") {
    console.error("[cloudSave] pull failed:", error.message);
  }
  return (data?.state_json as Record<string, unknown> | undefined) ?? null;
}

export async function listCloudSaves(user: User): Promise<
  Array<Pick<
    { slot_id: string; slot_name: string; character_name: string | null; day: number; updated_at: string },
    "slot_id" | "slot_name" | "character_name" | "day" | "updated_at"
  >>
> {
  if (!supabaseConfigured) return [];
  const { data } = await supabase
    .from("saves")
    .select("slot_id, slot_name, character_name, day, updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });
  return data ?? [];
}
