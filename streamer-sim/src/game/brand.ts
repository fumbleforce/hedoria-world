/**
 * Public stream brand — handle, channel copy, logo, and overlay styling.
 * Separate from settings.streamerName (private character identity).
 */

import type { NicheId } from "./niches";

export type FrameAccentId = "default" | "neon" | "warm" | "cool" | "minimal" | "ember";

export type LogoPresetId = "minimal" | "neon-badge" | "soft-glow" | "pixel" | "mascot" | "crest";

export interface LogoPresetDef {
  id: LogoPresetId;
  label: string;
  blurb: string;
  /** Describes the logo artwork only — no text, no UI chrome. */
  prompt: string;
}

/** Curated logo looks — each preset is a full visual brief for image gen. */
export const LOGO_PRESETS: LogoPresetDef[] = [
  {
    id: "minimal",
    label: "Minimal",
    blurb: "Flat geometric mark, two-tone",
    prompt:
      "Minimal flat vector emblem on a solid dark rounded-square backdrop. One simple geometric icon centered with generous padding, two-tone palette, crisp edges, modern streamer channel badge.",
  },
  {
    id: "neon-badge",
    label: "Neon badge",
    blurb: "Glowing outline on dark glass",
    prompt:
      "Neon-outlined channel badge on a deep purple-black rounded square. Single bold icon shape with soft outer glow, saturated magenta and cyan edge light, dark glassy fill, centered composition.",
  },
  {
    id: "soft-glow",
    label: "Soft glow",
    blurb: "Gradient orb, cozy and polished",
    prompt:
      "Soft gradient channel emblem on a muted dark backdrop. Rounded circular mark with gentle pink-to-violet radial glow, smooth matte finish, small sparkle highlights, centered and balanced.",
  },
  {
    id: "pixel",
    label: "Pixel",
    blurb: "Retro 8-bit icon tile",
    prompt:
      "Pixel-art channel icon on a dark square tile. Chunky 8-bit silhouette, limited bright palette, crisp pixel grid, retro gaming stream badge aesthetic, centered with even margins.",
  },
  {
    id: "mascot",
    label: "Mascot",
    blurb: "Friendly creature silhouette",
    prompt:
      "Cute mascot silhouette channel logo on a solid colored rounded square. Simple friendly creature head or pet icon, bold outlines, flat cel-shaded colors, playful streamer brand mark, centered.",
  },
  {
    id: "crest",
    label: "Crest",
    blurb: "Shield emblem, premium feel",
    prompt:
      "Heraldic crest-style channel emblem on a dark backdrop. Compact shield or badge shape with a single central symbol, gold and deep violet accents, polished esports team logo feel, symmetrical and centered.",
  },
];

export function logoPresetById(id: LogoPresetId | string | undefined): LogoPresetDef {
  return LOGO_PRESETS.find((p) => p.id === id) ?? LOGO_PRESETS[0];
}

export interface StreamBrand {
  /** Public @handle — lowercase internet username, 3–24 chars. */
  handle: string;
  /** Short channel blurb shown in stats and chat context. */
  description: string;
  /** Community rules injected into chat prompts. */
  rules: string;
  /** Default niche when starting a new stream session. */
  defaultNiche: NicheId;
  /** IndexedDB gallery id for the channel logo emblem. */
  logoId: string | null;
  /** Visual style preset used when generating the channel logo. */
  logoPreset: LogoPresetId;
  /** Free-text description of what the logo should depict (subject/motif). */
  logoBrief: string;
  /** Live stream overlay accent preset. */
  frameAccent: FrameAccentId;
}

export const FRAME_ACCENTS: { id: FrameAccentId; label: string; swatch: [string, string] }[] = [
  { id: "default", label: "Default", swatch: ["#7c5cff", "#3d2a7a"] },
  { id: "neon", label: "Neon", swatch: ["#00f5ff", "#ff00aa"] },
  { id: "warm", label: "Warm", swatch: ["#ff9f43", "#e55039"] },
  { id: "cool", label: "Cool", swatch: ["#48dbfb", "#0abde3"] },
  { id: "minimal", label: "Minimal", swatch: ["#576574", "#222f3e"] },
  { id: "ember", label: "Ember", swatch: ["#feca57", "#ff6b6b"] },
];

export const RULE_CHIPS = [
  "Be kind to each other",
  "No spoilers",
  "No backseat gaming",
  "Mods enforce the rules",
] as const;

const HANDLE_MIN = 3;
const HANDLE_MAX = 24;

/** Strip and normalize a raw handle input. */
export function normalizeHandle(raw: string): string {
  let h = raw.trim().replace(/^@+/, "").toLowerCase();
  h = h.replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
  if (h.length > HANDLE_MAX) h = h.slice(0, HANDLE_MAX);
  return h;
}

/** True when handle meets length and charset requirements. */
export function isValidHandle(handle: string): boolean {
  const h = normalizeHandle(handle);
  return h.length >= HANDLE_MIN && h.length <= HANDLE_MAX && /^[a-z0-9_]+$/.test(h);
}

/** Derive a starter handle from a character name. */
export function suggestHandle(streamerName: string): string {
  const base = normalizeHandle(streamerName);
  if (base.length >= HANDLE_MIN) return base.slice(0, HANDLE_MAX);
  const slug = base || "stream";
  const suffix = "_live";
  const combined = `${slug}${suffix}`.slice(0, HANDLE_MAX);
  return combined.length >= HANDLE_MIN ? combined : "streamer";
}

export function initialBrand(): StreamBrand {
  return {
    handle: "streamer",
    description: "",
    rules: "",
    defaultNiche: "variety",
    logoId: null,
    logoPreset: "minimal",
    logoBrief: "",
    frameAccent: "default",
  };
}

/** Merge persisted brand with defaults; migrate missing fields from legacy state. */
export function normalizeBrand(
  raw: Partial<StreamBrand> | undefined,
  fallback: { streamerName: string; nicheDraft: NicheId },
): StreamBrand {
  const base = initialBrand();
  if (!raw) {
    return {
      ...base,
      handle: suggestHandle(fallback.streamerName),
      defaultNiche: fallback.nicheDraft,
    };
  }
  const handle = normalizeHandle(raw.handle ?? suggestHandle(fallback.streamerName));
  return {
    handle: handle.length >= HANDLE_MIN ? handle : suggestHandle(fallback.streamerName),
    description: (raw.description ?? "").slice(0, 280),
    rules: (raw.rules ?? "").slice(0, 500),
    defaultNiche: raw.defaultNiche ?? fallback.nicheDraft,
    logoId: raw.logoId ?? null,
    logoPreset: logoPresetById(raw.logoPreset).id,
    logoBrief: (raw.logoBrief ?? "").slice(0, 200),
    frameAccent: raw.frameAccent ?? "default",
  };
}
