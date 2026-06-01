import { describe, expect, it } from "vitest";
import { ACTIVITY_BY_ID, activityVisible } from "../activities";
import { starterDeskCamera, type PlacedCamera } from "../cameras";

describe("activity visibility", () => {
  const deskOnly = [starterDeskCamera()];

  it("hides kitchen activities until a fixed kitchenette camera is placed", () => {
    const cook = ACTIVITY_BY_ID["cook-on-cam"];
    expect(activityVisible(cook, "wholesome", deskOnly)).toBe(false);

    const kitchenCam: PlacedCamera = {
      id: "kitchen-cam",
      tier: "webcam",
      label: "Kitchenette Cam",
      zone: "kitchenette",
    };
    expect(activityVisible(cook, "wholesome", [...deskOnly, kitchenCam])).toBe(true);
  });

  it("does not count portable cams toward required zones", () => {
    const cook = ACTIVITY_BY_ID["cook-on-cam"];
    const portable: PlacedCamera = {
      id: "portable",
      tier: "webcam",
      label: "Portable",
      zone: null,
      portable: true,
    };
    expect(activityVisible(cook, "wholesome", [...deskOnly, portable])).toBe(false);
  });

  it("shows desk games with the starter desk camera", () => {
    const horror = ACTIVITY_BY_ID.horror;
    expect(activityVisible(horror, "wholesome", deskOnly)).toBe(true);
  });
});
