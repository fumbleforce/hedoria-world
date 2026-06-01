/** Streamer gender presets for settings and onboarding. */

export type GenderPreset = "male" | "female" | "custom";

export const GENDER_OPTIONS: Array<{ id: GenderPreset; label: string }> = [
  { id: "female", label: "Female" },
  { id: "male", label: "Male" },
  { id: "custom", label: "Custom" },
];

export function genderMode(gender: string): GenderPreset {
  return gender === "male" ? "male" : gender === "female" ? "female" : "custom";
}
