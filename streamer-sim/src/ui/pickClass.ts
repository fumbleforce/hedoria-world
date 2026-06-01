/** Shared class names for selectable option cards (grids, presets, tiers). */

export function pickClass(selected?: boolean, extra?: string): string {
  return ["pick", selected && "pick--selected", extra].filter(Boolean).join(" ");
}
