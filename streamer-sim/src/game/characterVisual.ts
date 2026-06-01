import type { CharacterVisual } from "./types";
import { genderTerms } from "./cameras";

/** Drop a trailing period/whitespace so a template's own punctuation doesn't double up. */
function trimTrailingPeriod(text: string): string {
  return text.replace(/[.\s]+$/, "");
}

export const DEFAULT_FACE_DESCRIPTION =
  "Warm brown eyes, light freckles across her nose, soft natural makeup, warm approachable smile.";

export const DEFAULT_BODY_DESCRIPTION =
  "Early 20s woman, shoulder-length soft pink hair, petite build, cute bubbly streamer energy.";

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
