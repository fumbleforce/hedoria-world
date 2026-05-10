/**
 * Curated Gemini model ids for the HUD dropdowns. The store may hold any
 * non-empty string (e.g. a newer preview id); if it is not in this list the
 * UI still shows it as an extra `<option>`.
 */

export const GEMINI_TEXT_MODEL_OPTIONS: readonly string[] = [
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-3-flash-preview",
  "gemini-3.1-flash",
  "gemini-3.1-pro-preview",
];

export const GEMINI_IMAGE_MODEL_OPTIONS: readonly string[] = [
  "gemini-2.5-flash-image",
  "gemini-3.1-flash-image-preview",
];

function envTextModel(): string | undefined {
  const v = (import.meta.env.VITE_GEMINI_TEXT_MODEL as string | undefined)?.trim();
  return v || undefined;
}

function envImageModel(): string | undefined {
  const v = (import.meta.env.VITE_GEMINI_IMAGE_MODEL as string | undefined)?.trim();
  return v || undefined;
}

/** Default when nothing is persisted (matches previous boot behaviour). */
export function defaultGeminiTextModel(): string {
  return envTextModel() ?? "gemini-2.5-flash-lite";
}

export function defaultGeminiImageModel(): string {
  return envImageModel() ?? "gemini-2.5-flash-image";
}

/** Options for a `<select>`, always including the active id if it is custom. */
export function textModelSelectOptions(current: string): string[] {
  const cur = current.trim();
  if (!cur) return [...GEMINI_TEXT_MODEL_OPTIONS];
  if (GEMINI_TEXT_MODEL_OPTIONS.includes(cur)) return [...GEMINI_TEXT_MODEL_OPTIONS];
  return [cur, ...GEMINI_TEXT_MODEL_OPTIONS];
}

export function imageModelSelectOptions(current: string): string[] {
  const cur = current.trim();
  if (!cur) return [...GEMINI_IMAGE_MODEL_OPTIONS];
  if (GEMINI_IMAGE_MODEL_OPTIONS.includes(cur)) return [...GEMINI_IMAGE_MODEL_OPTIONS];
  return [cur, ...GEMINI_IMAGE_MODEL_OPTIONS];
}
