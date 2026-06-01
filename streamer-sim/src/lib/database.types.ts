/**
 * Minimal hand-written types for the Supabase schema.
 * Replace with generated types (`supabase gen types typescript`) for a production build.
 */

type ProfileRow = {
  id: string;
  email: string | null;
  subscription_status: "free" | "active" | "cancelled" | "past_due";
  subscription_tier: "free" | "pro";
  ls_customer_id: string | null;
  ls_subscription_id: string | null;
  created_at: string;
  updated_at: string;
};

type SaveRow = {
  id: string;
  user_id: string;
  slot_id: string;
  slot_name: string;
  state_json: Record<string, unknown>;
  character_name: string | null;
  day: number;
  portrait_id: string | null;
  created_at: string;
  updated_at: string;
};

type ImageMetaRow = {
  id: string;
  user_id: string;
  slot_id: string;
  cache_key: string;
  kind: string;
  label: string;
  prompt: string;
  character_name: string;
  meta: Record<string, string> | null;
  source_image_id: string | null;
  cloud_path: string;
  created_at: number;
};

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow;
        Insert: Partial<ProfileRow> & { id: string };
        Update: Partial<ProfileRow>;
        Relationships: [];
      };
      saves: {
        Row: SaveRow;
        Insert: Omit<SaveRow, "id" | "created_at"> & { id?: string; created_at?: string };
        Update: Partial<SaveRow>;
        Relationships: [];
      };
      image_meta: {
        Row: ImageMetaRow;
        Insert: ImageMetaRow;
        Update: Partial<ImageMetaRow>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
