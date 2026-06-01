/** Settings modal tabs — ids must match store `settingsTab` values. */

export const SETTINGS_TABS = [
  { id: "general", label: "General" },
  { id: "prompts", label: "Prompts" },
  { id: "room", label: "Room" },
  { id: "character", label: "Character" },
  { id: "brand", label: "Brand" },
  { id: "gallery", label: "Gallery" },
  { id: "llm", label: "LLM" },
  { id: "dev", label: "Dev" },
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number]["id"];
