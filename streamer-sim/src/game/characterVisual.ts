import type { CharacterVisual } from "./types";
import { genderTerms } from "./cameras";
import { genderMode } from "./gender";

/** Default age band used in starter personas, presets, and offline character templates. */
export const DEFAULT_STREAMER_AGE = "late 20s";

export function streamerAgeInPersona(gender: string): string {
  switch (genderMode(gender)) {
    case "male":
      return "in his late 20s";
    case "female":
      return "in her late 20s";
    default:
      return "in their late 20s";
  }
}

export function streamerAgeBodyOpener(gender: string): string {
  switch (genderMode(gender)) {
    case "male":
      return "Late 20s man";
    case "female":
      return "Late 20s woman";
    default:
      return "Late 20s nonbinary streamer";
  }
}

/** Drop a trailing period/whitespace so a template's own punctuation doesn't double up. */
function trimTrailingPeriod(text: string): string {
  return text.replace(/[.\s]+$/, "");
}

export const DEFAULT_FACE_DESCRIPTION =
  "Warm brown eyes, light freckles across her nose, soft natural makeup, warm approachable smile.";

export const DEFAULT_BODY_DESCRIPTION =
  "Late 20s woman, shoulder-length soft pink hair, normal build, cute bubbly streamer energy.";

export function defaultCharacterVisual(): CharacterVisual {
  return {
    faceDescription: DEFAULT_FACE_DESCRIPTION,
    bodyDescription: DEFAULT_BODY_DESCRIPTION,
    portraitId: null,
    bodyId: null,
  };
}

/** Hydrate persisted character visual, migrating legacy single `description`. */
export function normalizeCharacterVisual(
  raw: (Partial<CharacterVisual> & { description?: string }) | null | undefined,
): CharacterVisual {
  const base = defaultCharacterVisual();
  if (!raw) return base;

  const legacy = raw.description?.trim() ?? "";
  const face = raw.faceDescription?.trim() || legacy || DEFAULT_FACE_DESCRIPTION;
  const body = raw.bodyDescription?.trim() || legacy || DEFAULT_BODY_DESCRIPTION;

  return {
    faceDescription: face,
    bodyDescription: body,
    portraitId: raw.portraitId ?? null,
    bodyId: raw.bodyId ?? null,
  };
}

export function hasCharacterLook(c: CharacterVisual): boolean {
  return !!(c.bodyId || c.faceDescription.trim() || c.bodyDescription.trim());
}

/** Full look string for scene / presence prompts. */
export function combinedLook(c: CharacterVisual): string {
  const face = c.faceDescription.trim();
  const body = c.bodyDescription.trim();
  if (face && body) return `${face} ${body}`;
  return face || body;
}

/** Template vars for image prompts — `description` kept for legacy custom prompts. */
export function imagePromptVars(
  c: CharacterVisual,
  extra: Record<string, string>,
  mode: "portrait" | "body" | "full",
): Record<string, string> {
  const face = trimTrailingPeriod(c.faceDescription.trim());
  const body = trimTrailingPeriod(c.bodyDescription.trim());
  const combined = [face, body].filter(Boolean).join(" ");
  const description =
    mode === "portrait" ? face
      : mode === "body" ? body
        : combined;
  // Pronoun placeholders ({{subj}}/{{obj}}/{{poss}}) derived from the streamer's
  // gender so templates don't hardcode "she/her". `extra` may override these.
  const g = genderTerms(extra.gender);
  return {
    subj: g.subj,
    obj: g.obj,
    poss: g.poss,
    subjectNoun: g.subject,
    ...extra,
    faceDescription: face,
    bodyDescription: body,
    description,
  };
}
