import { describe, expect, it } from "vitest";
import {
  DEFAULT_BODY_DESCRIPTION,
  DEFAULT_FACE_DESCRIPTION,
  combinedLook,
  normalizeCharacterVisual,
} from "../characterVisual";

describe("characterVisual", () => {
  it("defaults face and body separately", () => {
    const c = normalizeCharacterVisual(null);
    expect(c.faceDescription).toBe(DEFAULT_FACE_DESCRIPTION);
    expect(c.bodyDescription).toBe(DEFAULT_BODY_DESCRIPTION);
  });

  it("migrates legacy single description into both fields", () => {
    const c = normalizeCharacterVisual({
      description: "Pink hair, green eyes, tall.",
      portraitId: "p1",
      bodyId: null,
    });
    expect(c.faceDescription).toBe("Pink hair, green eyes, tall.");
    expect(c.bodyDescription).toBe("Pink hair, green eyes, tall.");
    expect(c.portraitId).toBe("p1");
  });

  it("combinedLook joins face and body", () => {
    const c = normalizeCharacterVisual({
      faceDescription: "Freckles, warm smile.",
      bodyDescription: "Petite, pink hair.",
    });
    expect(combinedLook(c)).toBe("Freckles, warm smile. Petite, pink hair.");
  });
});
