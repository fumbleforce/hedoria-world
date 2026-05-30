/** UI color themes — applied via `data-theme` on `<html>`. */

import type { ThemeId } from "../game/types";

export const THEMES: Array<{ id: ThemeId; label: string; blurb: string; swatch: [string, string] }> = [
  { id: "limelight", label: "Limelight", blurb: "Pink & purple — the default neon streamer look.", swatch: ["#ff5d8f", "#b079ff"] },
  { id: "ocean", label: "Ocean", blurb: "Cool teal & cyan — calm late-night vibes.", swatch: ["#3bc9db", "#228be6"] },
  { id: "ember", label: "Ember", blurb: "Warm amber & gold — cozy fireplace energy.", swatch: ["#ffa94d", "#fab005"] },
];

export function applyTheme(theme: ThemeId): void {
  document.documentElement.dataset.theme = theme;
}
