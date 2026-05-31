import type { ZoneId } from "./studio";
import { ZONES } from "./studio";
import { uid } from "../rng/rng";

export type CameraTier = "webcam" | "hd1080" | "dslr";

export interface CameraTierDef {
  label: string;
  quality: number;
  viewerMult: number;
  hypeMult: number;
}

export const CAMERA_TIERS: Record<CameraTier, CameraTierDef> = {
  webcam: { label: "Webcam", quality: 1, viewerMult: 1, hypeMult: 1 },
  hd1080: { label: "1080p", quality: 2, viewerMult: 1.25, hypeMult: 1.05 },
  dslr: { label: "DSLR", quality: 3, viewerMult: 1.35, hypeMult: 1.08 },
};

/** A camera the player owns — placed in a zone, unplaced in bag, or portable. */
export interface PlacedCamera {
  id: string;
  tier: CameraTier;
  label: string;
  /** null = unplaced in inventory; portable cams ignore zone for go-live coverage. */
  zone: ZoneId | null;
  portable?: boolean;
}

export interface CameraShopItem {
  id: string;
  name: string;
  tier: CameraTier;
  cost: number;
  description: string;
  portable?: boolean;
}

export const STARTER_DESK_CAM_ID = "starter-desk-cam";

/** Purchasable cameras (separate from generic gear upgrades). */
export const CAMERA_SHOP: readonly CameraShopItem[] = [
  {
    id: "cam-1080p",
    name: "1080p Webcam Kit",
    tier: "hd1080",
    cost: 260,
    description: "Sharp picture for a second angle or a new zone.",
  },
  {
    id: "cam-dslr",
    name: "DSLR + Capture Card",
    tier: "dslr",
    cost: 700,
    description: "Cinematic look. Best production value.",
  },
  {
    id: "cam-portable",
    name: "Portable Streaming Cam",
    tier: "webcam",
    cost: 180,
    description: "Go live from anywhere at lower quality.",
    portable: true,
  },
];

/** Legacy gear upgrade ids whose production quality moved to the camera system. */
export const LEGACY_CAM_UPGRADE_IDS = new Set(["1080p-cam", "dslr-cam"]);

export function starterDeskCamera(): PlacedCamera {
  return {
    id: STARTER_DESK_CAM_ID,
    tier: "webcam",
    label: "Desk Cam",
    zone: "desk",
  };
}

/** Cameras covering a zone for go-live (portable covers all zones). */
export function cameraForZone(cameras: readonly PlacedCamera[], zone: ZoneId): PlacedCamera | null {
  const portable = cameras.find((c) => c.portable);
  if (portable) return portable;
  return cameras.find((c) => c.zone === zone) ?? null;
}

export function activeCamera(
  cameras: readonly PlacedCamera[],
  activeId: string | null,
): PlacedCamera | null {
  if (activeId) {
    const found = cameras.find((c) => c.id === activeId);
    if (found) return found;
  }
  const desk = cameras.find((c) => c.zone === "desk" && !c.portable);
  return desk ?? cameras.find((c) => c.zone && !c.portable) ?? cameras[0] ?? null;
}

/** Production quality from the active camera (portable gets a penalty). */
export function activeCameraQuality(cameras: readonly PlacedCamera[], activeId: string | null): number {
  const cam = activeCamera(cameras, activeId);
  if (!cam) return 0;
  const def = CAMERA_TIERS[cam.tier];
  const portablePenalty = cam.portable ? 0.5 : 0;
  return Math.max(0, def.quality - portablePenalty);
}

export function activeCameraMults(
  cameras: readonly PlacedCamera[],
  activeId: string | null,
): { viewerMult: number; hypeMult: number; quality: number } {
  const cam = activeCamera(cameras, activeId);
  if (!cam) return { viewerMult: 1, hypeMult: 1, quality: 0 };
  const def = CAMERA_TIERS[cam.tier];
  const portableScale = cam.portable ? 0.85 : 1;
  return {
    viewerMult: def.viewerMult * portableScale,
    hypeMult: def.hypeMult * portableScale,
    quality: activeCameraQuality(cameras, activeId),
  };
}

/** Distinct placed zones (each counts as a production angle). */
export function placedAngles(cameras: readonly PlacedCamera[]): PlacedCamera[] {
  const seen = new Set<ZoneId>();
  return cameras.filter((c) => {
    if (!c.zone || c.portable) return false;
    if (seen.has(c.zone)) return false;
    seen.add(c.zone);
    return true;
  });
}

/** Multiplier bump from having multiple camera angles (capped). */
export function angleProductionBump(angleCount: number): { viewerMult: number; hypeMult: number } {
  const extra = Math.max(0, angleCount - 1);
  const bump = Math.min(extra * 0.04, 0.12);
  return { viewerMult: 1 + bump, hypeMult: 1 + bump * 0.5 };
}

export function unplacedCameras(cameras: readonly PlacedCamera[]): PlacedCamera[] {
  return cameras.filter((c) => !c.zone && !c.portable);
}

export function onScreenZone(
  cameras: readonly PlacedCamera[],
  activeId: string | null,
  playerZone: ZoneId,
): ZoneId {
  const cam = activeCamera(cameras, activeId);
  if (cam?.portable) return playerZone;
  return cam?.zone ?? playerZone;
}

export function isPlayerOnActiveCamera(
  cameras: readonly PlacedCamera[],
  activeId: string | null,
  playerZone: ZoneId,
): boolean {
  const cam = activeCamera(cameras, activeId);
  if (!cam) return false;
  if (cam.portable) return true;
  return cam.zone === playerZone;
}

export function defaultCameraLabel(tier: CameraTier, zone: ZoneId | null): string {
  if (zone) return `${ZONES[zone]?.label ?? zone} Cam`;
  return `${CAMERA_TIERS[tier].label} Cam`;
}

export function migrateLegacyCamUpgrades(
  cameras: PlacedCamera[] | undefined,
  ownedUpgrades: string[],
): { cameras: PlacedCamera[]; activeCameraId: string | null } {
  let list = cameras?.length ? [...cameras] : [starterDeskCamera()];
  const hasDesk = list.some((c) => c.zone === "desk" && !c.portable);
  if (!hasDesk) list.unshift(starterDeskCamera());

  if (ownedUpgrades.includes("1080p-cam") && !list.some((c) => c.tier === "hd1080" && c.zone === null)) {
    list.push({
      id: uid("cam"),
      tier: "hd1080",
      label: "1080p Cam",
      zone: null,
    });
  }
  if (ownedUpgrades.includes("dslr-cam") && !list.some((c) => c.tier === "dslr" && c.zone === null)) {
    list.push({
      id: uid("cam"),
      tier: "dslr",
      label: "DSLR Rig",
      zone: null,
    });
  }

  const deskCam = list.find((c) => c.id === STARTER_DESK_CAM_ID) ?? list.find((c) => c.zone === "desk");
  return { cameras: list, activeCameraId: deskCam?.id ?? list[0]?.id ?? null };
}

export function formatCameraTier(tier: CameraTier): string {
  return CAMERA_TIERS[tier].label;
}
