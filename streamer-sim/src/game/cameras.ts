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

/**
 * Camera covering a zone for go-live. A fixed camera placed in the zone wins
 * (best quality); a portable cam is only the fallback where no fixed cam exists,
 * so owning a portable never shadows your good rigs.
 */
export function cameraForZone(cameras: readonly PlacedCamera[], zone: ZoneId): PlacedCamera | null {
  const fixed = cameras.find((c) => c.zone === zone && !c.portable);
  if (fixed) return fixed;
  return cameras.find((c) => c.portable) ?? null;
}

/** True when a non-portable camera is placed in the zone (portable cams do not count). */
export function hasFixedCameraInZone(cameras: readonly PlacedCamera[], zone: ZoneId): boolean {
  return cameras.some((c) => c.zone === zone && !c.portable);
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

/**
 * Zones that capture private moments. Cameras may only be set up here on a
 * No-Limits content tier — otherwise the player could film themselves in the
 * bathroom or in bed even on tame settings.
 */
export const PRIVATE_CAM_ZONES: ReadonlySet<ZoneId> = new Set<ZoneId>(["bed", "bathroom"]);

/** Whether a fixed camera may be placed in `zone` given the current tier. */
export function canPlaceCameraInZone(zone: ZoneId, noLimits: boolean): boolean {
  return noLimits || !PRIVATE_CAM_ZONES.has(zone);
}

/**
 * Display name that combines location + camera type, e.g. "Bathroom · DSLR".
 * The stored `label` alone (e.g. "DSLR Rig") doesn't say where the angle is.
 */
export function cameraDisplayLabel(cam: PlacedCamera): string {
  const tier = CAMERA_TIERS[cam.tier].label;
  if (cam.portable) return `${tier} (portable)`;
  if (cam.zone) return `${ZONES[cam.zone]?.label ?? cam.zone} · ${tier}`;
  return `${tier} Cam`;
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

/**
 * Eye-level single-furniture description for each zone corner. Kept to only the
 * furniture the room art actually contains — no invented decor — so the prompt
 * never asks for items (fairy lights, posters, plants) that aren't in the room.
 */
export const ZONE_CORNER: Record<ZoneId, string> = {
  desk: "a desk with dual monitors and a ring light",
  bed: "an unmade bed",
  couch: "a comfy couch with a rug",
  kitchenette: "a kitchenette counter with a hot plate and a kettle",
  // From across the room the bathroom reads only as a closed door in the wall.
  bathroom: "a closed bathroom door",
  door: "a front door",
};

/** What the camera sees once it is inside the bathroom (interior, not the rest of the room). */
export const BATHROOM_INTERIOR =
  "a small bathroom interior with a sink, a mirror and soft tiled walls";

/** Short area label for each zone, naming the section of the room map to look at. */
export const ZONE_AREA: Record<ZoneId, string> = {
  desk: "desk area",
  bed: "bed area",
  couch: "couch area",
  kitchenette: "kitchenette",
  bathroom: "bathroom nook",
  door: "front door",
};

/** Which other corners are visible from each zone's camera perspective. */
export const ZONE_VISIBLE: Record<ZoneId, ZoneId[]> = {
  desk: ["couch", "kitchenette", "door", "bathroom"],
  bed: ["couch", "desk", "kitchenette", "door"],
  couch: ["desk", "kitchenette", "door", "bathroom"],
  kitchenette: ["couch", "door", "desk"],
  door: ["couch", "kitchenette", "bathroom"],
  // Inside the bathroom the camera sees only the bathroom interior, no other zones.
  bathroom: [],
};

export function visibleCorners(zone: ZoneId): ZoneId[] {
  return ZONE_VISIBLE[zone] ?? [];
}

export function cornerDescription(zone: ZoneId): string {
  return ZONE_CORNER[zone] ?? "apartment furniture";
}

export function zoneArea(zone: ZoneId): string {
  return ZONE_AREA[zone] ?? "room";
}

/** Text fallback when no perspective image exists yet. */
export function zoneBackdropText(zone: ZoneId): string {
  if (zone === "bathroom") return BATHROOM_INTERIOR;
  const parts = visibleCorners(zone).map((z) => cornerDescription(z));
  return parts.length ? parts.join("; ") : "a studio apartment interior";
}

/**
 * Immersive first-person framing shared by the interior tiers. The negative
 * clauses ("no top of walls, no empty background") intentionally break the
 * no-negative-prompts rule — they measurably stabilise the interior framing.
 */
const INTERIOR_FRAMING =
  "Show only the interior, from the perspective of a person in the room. No top of walls, no empty background, immersive, first-person view.";

/**
 * Tier 1: floor-level angled (visual-novel) photo of one zone's furniture, framed as a section of the room map.
 * Mood/medium/lighting come entirely from `style`; only scene content and framing live here.
 */
export function cornerPrompt(zone: ZoneId, style: string, matchRoom: boolean): string {
  const desc = cornerDescription(zone);
  return [
    matchRoom
      ? `We are inside the room. An angled photo of the ${zoneArea(zone)} of the apartment in the provided image. The photo is taken from the center of the room, at floor level, looking over towards: a corner with ${desc} and two walls.`
      : `We are inside the room. An angled photo taken from the center of the room, at floor level, looking over towards: a corner with ${desc} and two walls.`,
    INTERIOR_FRAMING,
    style,
    "No people in frame. Square composition.",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Tier 2: floor-level angled (visual-novel) room view looking over towards the visible corners.
 * Mood/medium/lighting come entirely from `style`; only scene content and framing live here.
 */
export function perspectivePrompt(zone: ZoneId, style: string, matchRoom: boolean): string {
  // The bathroom is an enclosed space: show its interior only, never the rest of the room.
  if (zone === "bathroom") {
    return [
      matchRoom
        ? `We are inside the bathroom. An angled photo of the bathroom of the apartment in the provided image. The photo is taken from inside the bathroom, at floor level, looking over towards: ${BATHROOM_INTERIOR}.`
        : `We are inside the bathroom. An angled photo taken from inside a small bathroom, at floor level, looking over towards: ${BATHROOM_INTERIOR}.`,
      INTERIOR_FRAMING,
      style,
      "No people in frame. Square composition.",
    ]
      .filter(Boolean)
      .join(" ");
  }
  const seen = visibleCorners(zone);
  const inView = seen.map((z) => cornerDescription(z)).join("; ");
  const areas = seen.map((z) => zoneArea(z)).join(", ");
  return [
    matchRoom
      ? `We are inside the room. An angled photo of the apartment in the provided image. The photo is taken from the center of the room, at floor level, looking over towards the ${areas}: ${inView}.`
      : `We are inside the room. An angled photo taken from the center of the room, at floor level, looking over towards: ${inView}.`,
    INTERIOR_FRAMING,
    style,
    "No people in frame. Square composition.",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Default posture for the streamer when the zone's camera is on them (mock/idle fallback). */
const ZONE_POSTURE: Record<ZoneId, string> = {
  desk: "sitting in the gaming chair at the desk, leaning toward the mic",
  bed: "lounging on the bed, propped against the pillows",
  couch: "sitting back on the couch, relaxed",
  kitchenette: "standing at the kitchenette counter",
  bathroom: "standing at the bathroom mirror",
  door: "standing near the front door",
};

export function zonePosture(zone: ZoneId): string {
  return ZONE_POSTURE[zone] ?? "in a natural, relaxed pose";
}

/** Neutral prepositional location for the subject (avoids the literal "Streaming Desk" label). */
const ZONE_PLACE: Record<ZoneId, string> = {
  desk: "at the desk",
  bed: "in the bedroom corner",
  couch: "on the couch",
  kitchenette: "in the kitchenette",
  bathroom: "in the bathroom",
  door: "by the front door",
};

export function zonePlace(zone: ZoneId): string {
  return ZONE_PLACE[zone] ?? "in the apartment";
}

/**
 * Camera tier expressed as a photographic-quality phrase. We deliberately avoid
 * words like "webcam" / "stream" in the prompt — they make image models paint
 * fake stream UI, cam decals and overlays.
 */
const TIER_QUALITY: Record<CameraTier, string> = {
  webcam: "a slightly soft, casual snapshot",
  hd1080: "a crisp, sharp photo",
  dslr: "a crisp, cinematic high-quality photo",
};

/**
 * Strip broadcast vocabulary from a dynamic action clause so it can't smuggle
 * "stream"/"webcam"/"live"/"on cam" back into the image prompt (those words make
 * the model paint fake stream UI and cam decals).
 */
function stripBroadcastWords(text: string): string {
  return text
    .replace(/\bon[-\s]?cam(era)?\b/gi, "in the room")
    .replace(/\b(live[-\s]?stream(ing)?|stream(ing)?|broadcast(ing)?)\b/gi, "")
    .replace(/\bwebcams?\b/gi, "camera")
    .replace(/\btwitch\b/gi, "")
    .replace(/\blive\b/gi, "")
    .replace(/\s+([,.;—-])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Subject noun + pronouns derived from the free-text player gender. */
export interface GenderTerms {
  /** "woman in her late 20s" / "man in his late 20s" / "person in their late 20s". */
  subject: string;
  /** she / he / they. */
  subj: string;
  /** her / him / them. */
  obj: string;
  /** her / his / their. */
  poss: string;
  /** Whether the subject takes a plural verb ("they are" vs "she is"). */
  plural: boolean;
}

/** Map a free-text gender ("male", "female", or custom) to subject + pronouns. */
export function genderTerms(gender: string | undefined): GenderTerms {
  const g = (gender ?? "").toLowerCase();
  if (/\b(female|woman|women|girl|she|her|feminine)\b/.test(g)) {
    return { subject: "woman in her late 20s", subj: "she", obj: "her", poss: "her", plural: false };
  }
  if (/\b(male|man|men|boy|guy|he|him|his|masculine)\b/.test(g)) {
    return { subject: "man in his late 20s", subj: "he", obj: "him", poss: "his", plural: false };
  }
  return { subject: "person in their late 20s", subj: "they", obj: "them", poss: "their", plural: true };
}

function cap(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Eye-level candid portrait prompt for the live feed. The room comes from a
 * provided backdrop reference image when available; posture is driven by `doing`
 * (the live action) and falls back to a per-zone resting posture. Phrased as a
 * plain photo so no fake broadcast UI is rendered.
 */
export function camFootagePrompt(opts: {
  name: string;
  zoneId: ZoneId;
  tier: CameraTier;
  /** Free-text player gender; drives subject noun and pronouns. */
  gender?: string;
  faceDescription: string;
  bodyDescription: string;
  equippedLook: string;
  style: string;
  /** Whether a room backdrop reference image is attached. */
  hasBackdropRef: boolean;
  /** Resting posture hint (used when no live action drives the pose). */
  posture?: string;
  /** What the subject is actively doing right now — drives a dynamic pose. */
  doing?: string;
  /** Active activity segment label (e.g. "🏋️ Follow-Along Workout"). */
  activityLabel?: string;
  /** Narration hint for the active activity. */
  activityHint?: string;
}): string {
  const g = genderTerms(opts.gender);
  const are = g.plural ? "are" : "is";
  const wearing =
    opts.equippedLook !== "casual default" ? ` ${cap(g.subj)} ${are} wearing ${opts.equippedLook}.` : "";
  const action = opts.doing ? stripBroadcastWords(opts.doing) : "";
  const activityLabel = opts.activityLabel?.trim();
  const activityHint = opts.activityHint ? stripBroadcastWords(opts.activityHint.trim()) : "";
  const hasAction = !!action || !!activityLabel;
  const activityLine = activityLabel
    ? `Active segment: ${activityLabel}${activityHint ? ` — ${activityHint}` : ""}.`
    : "";
  // A live action wins the pose; otherwise rest in the zone's default posture.
  const poseLine = action
    ? `Right now: ${action}. Capture ${g.obj} mid-moment with the matching body language and pose.`
    : `${cap(g.subj)} ${are} ${opts.posture ?? zonePosture(opts.zoneId)}.`;
  const framingLine = hasAction
    ? `${cap(g.subj)} ${g.plural ? "face" : "faces"} the camera in a front-on candid framing wide enough to show the full body and movement — not seated or waist-up unless the action requires it.`
    : `${cap(g.subj)} ${g.plural ? "face" : "faces"} the camera directly, waist-up, in a natural relaxed framing.`;
  const background = opts.hasBackdropRef
    ? `${cap(g.subj)} ${are} in the room shown in the provided photo, which fills the background behind ${g.obj}.`
    : `Behind ${g.obj}: ${zoneBackdropText(opts.zoneId)}.`;
  const quality = TIER_QUALITY[opts.tier] ?? "a candid photo";
  return [
    `An eye-level, front-on candid photo of ${opts.name}, a ${g.subject}, ${zonePlace(opts.zoneId)}; ${quality}.`,
    activityLine,
    framingLine,
    poseLine,
    background,
    `${cap(g.subj)} ${g.plural ? "match" : "matches"} the character reference — face: ${opts.faceDescription}; hair and build: ${opts.bodyDescription}.${wearing}`,
    opts.style,
    "Square composition.",
  ]
    .filter(Boolean)
    .join(" ");
}
