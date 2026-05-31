import { describe, expect, it } from "vitest";
import {
  activeCameraMults,
  activeCameraQuality,
  angleProductionBump,
  cameraForZone,
  camFootagePrompt,
  cornerPrompt,
  perspectivePrompt,
  visibleCorners,
  ZONE_VISIBLE,
  placedAngles,
  starterDeskCamera,
  type PlacedCamera,
} from "../cameras";
import type { ZoneId } from "../studio";

describe("cameras", () => {
  const desk = starterDeskCamera();
  const couchCam: PlacedCamera = {
    id: "couch-cam",
    tier: "hd1080",
    label: "Couch Cam",
    zone: "couch",
  };

  it("starter desk cam allows go-live at desk only", () => {
    expect(cameraForZone([desk], "desk")).toBeTruthy();
    expect(cameraForZone([desk], "couch")).toBeNull();
  });

  it("placed couch cam unlocks couch streaming", () => {
    const cams = [desk, couchCam];
    expect(cameraForZone(cams, "couch")?.id).toBe("couch-cam");
  });

  it("portable cam covers any zone", () => {
    const portable: PlacedCamera = {
      id: "portable",
      tier: "webcam",
      label: "Portable",
      zone: null,
      portable: true,
    };
    expect(cameraForZone([desk, portable], "kitchenette")?.portable).toBe(true);
  });

  it("a fixed camera in the zone wins over a portable (no shadowing)", () => {
    const portable: PlacedCamera = {
      id: "portable",
      tier: "webcam",
      label: "Portable",
      zone: null,
      portable: true,
    };
    // At the desk, the fixed desk cam must be chosen, not the portable.
    expect(cameraForZone([desk, portable], "desk")?.id).toBe(desk.id);
    // At the couch (no fixed cam), the portable is the fallback.
    expect(cameraForZone([desk, portable], "couch")?.portable).toBe(true);
  });

  it("active camera quality scales with tier", () => {
    const dslr: PlacedCamera = { id: "d", tier: "dslr", label: "DSLR", zone: "bed" };
    expect(activeCameraQuality([dslr], "d")).toBe(3);
    expect(activeCameraMults([dslr], "d").quality).toBe(3);
  });

  it("multiple angles give production bump", () => {
    const bump = angleProductionBump(placedAngles([desk, couchCam]).length);
    expect(bump.viewerMult).toBeGreaterThan(1);
  });

  it("cam footage prompt is eye-level, positive, and free of stream-UI trigger words", () => {
    const p = camFootagePrompt({
      name: "Abby",
      zoneId: "desk",
      tier: "hd1080",
      gender: "female",
      faceDescription: "Warm smile.",
      bodyDescription: "Pink hair.",
      equippedLook: "casual default",
      style: "cozy neon",
      hasBackdropRef: false,
    });
    expect(p).toMatch(/eye-level/i);
    // No "don't think of elephants" subject negations.
    expect(p).not.toMatch(/do NOT/i);
    expect(p).not.toMatch(/floor plan/i);
    // Words that make models paint fake broadcast UI / cam decals must be absent.
    expect(p).not.toMatch(/webcam/i);
    expect(p).not.toMatch(/stream/i);
    expect(p).not.toMatch(/\blive\b/i);
    expect(p).not.toMatch(/twitch/i);
    // No live action provided → falls back to the zone resting posture.
    expect(p).toMatch(/sitting in the gaming chair/i);
    // Female gender → she/her pronouns.
    expect(p).toMatch(/young woman/i);
    expect(p).toMatch(/behind her/i);
  });

  it("uses male subject and pronouns when gender is male", () => {
    const p = camFootagePrompt({
      name: "Rob",
      zoneId: "desk",
      tier: "hd1080",
      gender: "male",
      faceDescription: "Black hair, green eyes.",
      bodyDescription: "Lanky build.",
      equippedLook: "casual default",
      style: "cozy neon",
      hasBackdropRef: true,
    });
    expect(p).toMatch(/young man/i);
    expect(p).toMatch(/\bHe is\b/);
    expect(p).toMatch(/behind him/i);
    expect(p).not.toMatch(/young woman/i);
    expect(p).not.toMatch(/\bshe\b/i);
  });

  it("a live action drives a dynamic pose and the backdrop reference is used", () => {
    const p = camFootagePrompt({
      name: "Abby",
      zoneId: "desk",
      tier: "hd1080",
      gender: "female",
      faceDescription: "Warm smile.",
      bodyDescription: "Pink hair.",
      equippedLook: "frilly crop top",
      style: "cozy neon",
      hasBackdropRef: true,
      posture: "sitting in the gaming chair at the desk",
      doing: "standing up and dancing to a pop song",
    });
    // The action wins over the static posture.
    expect(p).toMatch(/dancing to a pop song/i);
    expect(p).not.toMatch(/sitting in the gaming chair/i);
    // With a perspective photo attached, the prompt places her in that room.
    expect(p).toMatch(/room shown in the provided photo/i);
    expect(p).toMatch(/frilly crop top/i);
    // Styling (lighting/mood/DOF) must come from the style line, not be hardcoded.
    expect(p).not.toMatch(/shallow depth of field/i);
    expect(p).not.toMatch(/warm cozy indoor lighting/i);
  });

  it("corner prompt frames the desk as a floor-level section of the provided room image", () => {
    const p = cornerPrompt("desk", "cozy neon", true);
    expect(p).toMatch(/angled/i);
    expect(p).toMatch(/floor level/i);
    // Immersive first-person interior framing.
    expect(p).toMatch(/inside the room/i);
    expect(p).toMatch(/first-person/i);
    expect(p).toMatch(/two walls/i);
    expect(p).toMatch(/monitors/i);
    // References the section of the provided reference image.
    expect(p).toMatch(/desk area/i);
    expect(p).toMatch(/provided image/i);
    expect(p).not.toMatch(/webcam/i);
    expect(p).not.toMatch(/stream/i);
    expect(p).not.toMatch(/top-down/i);
    // No invented decor that isn't in the room.
    expect(p).not.toMatch(/fairy lights|string lights|posters/i);
  });

  it("perspective prompt for desk looks over toward visible corners from floor level, excluding bed", () => {
    const p = perspectivePrompt("desk", "cozy neon", true);
    expect(p).toMatch(/angled/i);
    expect(p).toMatch(/floor level/i);
    expect(p).toMatch(/looking over towards/i);
    expect(p).toMatch(/couch|kitchenette|front door|bathroom/i);
    expect(p).not.toMatch(/unmade bed/i);
  });

  it("bathroom is enclosed: no other zones reference its interior, and its own view shows only the interior", () => {
    // Inside the bathroom the camera sees no other zones.
    expect(visibleCorners("bathroom")).toEqual([]);
    const p = perspectivePrompt("bathroom", "cozy neon", true);
    expect(p).toMatch(/bathroom/i);
    expect(p).toMatch(/sink|mirror|tiled/i);
    // It must not pull in the rest of the room.
    expect(p).not.toMatch(/couch|kitchenette|front door|desk|monitors|unmade bed/i);
    // From the outside the bathroom reads as a closed door, not an interior.
    const fromDesk = perspectivePrompt("desk", "cozy neon", true);
    expect(fromDesk).toMatch(/closed bathroom door/i);
    expect(fromDesk).not.toMatch(/sink|tiled/i);
  });

  it("ZONE_VISIBLE never lists a zone as visible from itself and desk excludes bed", () => {
    for (const zone of Object.keys(ZONE_VISIBLE) as ZoneId[]) {
      expect(visibleCorners(zone)).not.toContain(zone);
    }
    expect(visibleCorners("desk")).not.toContain("bed");
    expect(visibleCorners("desk")).toEqual(
      expect.arrayContaining(["couch", "kitchenette", "door", "bathroom"]),
    );
  });
});
