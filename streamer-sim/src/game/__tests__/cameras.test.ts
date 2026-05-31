import { describe, expect, it } from "vitest";
import {
  activeCameraMults,
  activeCameraQuality,
  angleProductionBump,
  cameraForZone,
  placedAngles,
  starterDeskCamera,
  type PlacedCamera,
} from "../cameras";

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
});
