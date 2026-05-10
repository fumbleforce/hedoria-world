import { Html } from "@react-three/drei";
import { memo, useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import type { ComposedSceneSpec, Exit, SceneSpec } from "./sceneSpec";
import { isInteriorArchetype } from "./sceneSpec";
import { getTemplate } from "./templates";

export type LocationProxyProps = {
  locationId: string;
  /** World-space center for the location patch. */
  position: [number, number];
  /** The composed location spec (or undefined if still loading). */
  composed?: ComposedSceneSpec;
  /** The bare location-scope spec, used for silhouette LoD. */
  locationSpec?: SceneSpec;
  /** Patch radius in world units (controls feature scaling). */
  patchRadius?: number;
  /** Optional human label rendered when the player is near. */
  label?: string;
  /**
   * Single shared LoD broker driven by the Overworld's centralised useFrame.
   * Each LocationProxy subscribes once on mount and re-renders only when its
   * own LoD bucket changes, so 114 patches don't each run their own
   * per-frame distance check.
   */
  lodBroker: LodBroker;
  /** Called when the player clicks a `door-portal` exit on this location.
   *  Receives the exit's *world* position so callers can do proximity gating. */
  onExitClick?: (locationId: string, exit: Exit, worldX: number, worldZ: number) => void;
  /** Children rendered on top of the patch (usually NPC billboards). */
  children?: React.ReactNode;
};

const DEFAULT_PATCH_RADIUS = 16;

export type Lod = "silhouette" | "mid" | "near";

// LoD thresholds scale with the location's own patch radius so big cities
// (radius=3) don't pop to "near" only when the player is on top of their
// fountain, and tiny hamlets (radius=1) don't render mid-LoD detail from
// the next region over.
export function lodFor(distance: number, patchRadius: number): Lod {
  const near = patchRadius * 1.0;
  const mid = patchRadius * 2.6;
  if (distance > mid) return "silhouette";
  if (distance > near) return "mid";
  return "near";
}

type LodSubscription = {
  pos: [number, number];
  radius: number;
  last: Lod;
  cb: (lod: Lod) => void;
};

/**
 * Single source of truth for per-location LoD. Owned by the Overworld and
 * driven by its single useFrame; each LocationProxy registers a callback
 * and is woken up *only* when its own LoD bucket changes.
 *
 * Why this matters: with 114+ locations, giving each one its own useFrame
 * meant ~6800 distance computations *per second* even when the player was
 * standing still — and forced react-three-fiber to wake the render loop
 * for the same reason. Now there's one update path, gated on whether the
 * player actually moved.
 */
export class LodBroker {
  private subs = new Map<string, LodSubscription>();
  private lastPos: [number, number] = [Number.NaN, Number.NaN];

  subscribe(
    id: string,
    pos: [number, number],
    radius: number,
    cb: (lod: Lod) => void,
  ): () => void {
    const px = Number.isFinite(this.lastPos[0]) ? this.lastPos[0] : 0;
    const pz = Number.isFinite(this.lastPos[1]) ? this.lastPos[1] : 0;
    const initial = lodFor(Math.hypot(pos[0] - px, pos[1] - pz), radius);
    this.subs.set(id, { pos, radius, last: initial, cb });
    cb(initial);
    return () => {
      this.subs.delete(id);
    };
  }

  /** Push a fresh player position. Returns true if any subscriber changed
   *  bucket (so the caller can decide whether other downstream work is
   *  worth doing). */
  update(playerX: number, playerZ: number): boolean {
    if (playerX === this.lastPos[0] && playerZ === this.lastPos[1]) return false;
    this.lastPos[0] = playerX;
    this.lastPos[1] = playerZ;
    let changed = false;
    for (const sub of this.subs.values()) {
      const dx = sub.pos[0] - playerX;
      const dz = sub.pos[1] - playerZ;
      const next = lodFor(Math.hypot(dx, dz), sub.radius);
      if (next !== sub.last) {
        sub.last = next;
        sub.cb(next);
        changed = true;
      }
    }
    return changed;
  }
}

/**
 * A location rendered as a *patch* of detail on the regional ground. LoD:
 *  - silhouette: a couple of low-detail blocks (towers / tree clusters) so the
 *    location is visible from far away.
 *  - mid: location-scope features (built/natural footprint).
 *  - near: also instantiates the active area's features (the player's current
 *    pad/court). Indoor areas continue to be rendered via a separate sub-scene
 *    when the player triggers a door-portal exit.
 */
function LocationProxyImpl({
  locationId,
  position,
  composed,
  locationSpec,
  patchRadius = DEFAULT_PATCH_RADIUS,
  label,
  lodBroker,
  onExitClick,
  children,
}: LocationProxyProps) {
  const [lod, setLod] = useState<Lod>("silhouette");

  useEffect(() => {
    return lodBroker.subscribe(locationId, position, patchRadius, setLod);
  }, [lodBroker, locationId, position, patchRadius]);

  const palette = composed?.surface.palette ?? ["#7a7a7a", "#5e5e5e", "#9aa0a6"];
  const accent = palette[1] ?? palette[0];
  const interior = composed ? isInteriorArchetype(composed.archetype) : false;

  const silhouette = useMemo(() => {
    const archetype = locationSpec?.archetype ?? composed?.archetype ?? "open-built";
    const spec = locationSpec ?? composed?.sources.location;
    const featureCount = spec?.features.length ?? 0;
    const isBuilt = archetype.startsWith("open-built") || archetype.startsWith("packed-built");
    const items: Array<{ template: string; x: number; z: number; scale: number }> = [];
    const max = Math.max(2, Math.min(4, featureCount || 3));
    for (let i = 0; i < max; i += 1) {
      const angle = (i / max) * Math.PI * 2 + 0.4;
      const r = patchRadius * 0.4;
      items.push({
        template: isBuilt ? (i % 2 === 0 ? "tower" : "house") : "tree-cluster",
        x: Math.cos(angle) * r,
        z: Math.sin(angle) * r,
        scale: isBuilt ? 0.7 : 0.9,
      });
    }
    return { items, isBuilt };
  }, [locationSpec, composed, patchRadius]);

  return (
    <group position={[position[0], 0, position[1]]}>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
        renderOrder={3}
      >
        <circleGeometry args={[patchRadius, 48]} />
        <meshStandardMaterial
          color={palette[0]}
          roughness={interior ? 0.5 : 0.95}
          polygonOffset
          polygonOffsetFactor={-3}
          polygonOffsetUnits={-6}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={4}>
        <ringGeometry args={[patchRadius * 0.95, patchRadius, 64]} />
        <meshBasicMaterial
          color={accent}
          side={THREE.DoubleSide}
          transparent
          opacity={0.55}
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-4}
          polygonOffsetUnits={-8}
        />
      </mesh>

      {lod === "silhouette" ? (
        <>
          {silhouette.items.map((item, i) => {
            const Template = getTemplate(item.template as never);
            return (
              <Template
                key={`sil-${i}`}
                position={[item.x, 0, item.z]}
                rotation={i * 0.6}
                scale={item.scale}
                palette={palette}
              />
            );
          })}
          {label ? (
            <Html distanceFactor={120} position={[0, 6, 0]} center zIndexRange={[10, 0]}>
              <div className="floatingLabel">{label}</div>
            </Html>
          ) : null}
        </>
      ) : null}

      {(lod === "mid" || lod === "near") && composed ? (
        <FeaturePatch
          composed={composed}
          locationSpec={locationSpec}
          includeArea={lod === "near"}
          patchRadius={patchRadius}
          locationId={locationId}
          locationPosition={position}
          onExitClick={onExitClick}
        />
      ) : null}

      {label && lod === "near" ? (
        <Html distanceFactor={30} position={[0, 4, 0]} center zIndexRange={[10, 0]}>
          <div className="floatingLabel">{label}</div>
        </Html>
      ) : null}

      {children}
    </group>
  );
}

/**
 * Memoised so that an OverworldContent re-render (e.g. when proximity changes
 * or a spec resolves) doesn't reconcile *all 114 patches* — only those whose
 * shallowly-compared props actually changed. The hot path during walking is
 * the LoD broker firing `setLod` on the few patches the player crosses; those
 * re-render via internal state without touching the others.
 *
 * NOTE: prop refs must be stable across parent re-renders for this to work.
 *  - `position`, `composed`, `locationSpec`, `lodBroker` come from useMemo
 *    in Overworld and are stable until layout/cache change.
 *  - `onExitClick` is wrapped in a stable `useRef`-indirected callback in
 *    Overworld so its identity doesn't flicker each parent render.
 *  - `children` is `null` for distant locations (returned by App's
 *    `renderNpcsForLocation` when there are no nearby NPCs); for nearby
 *    locations the children change with NPC visibility, which is the right
 *    re-render trigger anyway.
 */
export const LocationProxy = memo(LocationProxyImpl);

function FeaturePatch({
  composed,
  locationSpec,
  includeArea,
  patchRadius,
  locationId,
  locationPosition,
  onExitClick,
}: {
  composed: ComposedSceneSpec;
  locationSpec?: SceneSpec;
  includeArea: boolean;
  patchRadius: number;
  locationId: string;
  locationPosition: [number, number];
  onExitClick?: (locationId: string, exit: Exit, worldX: number, worldZ: number) => void;
}) {
  const palette = composed.surface.palette;
  const features = useMemo(() => {
    const out: Array<{
      template: string;
      x: number;
      z: number;
      rotation?: number;
      scale: number;
      label?: string;
      source: string;
    }> = [];
    const locFeatures = locationSpec?.features ?? composed.sources.location?.features ?? [];
    for (const feature of locFeatures) {
      out.push({
        template: feature.template,
        x: feature.x * patchRadius,
        z: feature.z * patchRadius,
        rotation: feature.rotation,
        scale: feature.scale ?? 1,
        label: feature.label,
        source: "location",
      });
    }
    if (includeArea && composed.sources.area) {
      for (const feature of composed.sources.area.features) {
        out.push({
          template: feature.template,
          x: feature.x * patchRadius * 0.75,
          z: feature.z * patchRadius * 0.75,
          rotation: feature.rotation,
          scale: feature.scale ?? 1,
          label: feature.label,
          source: "area",
        });
      }
    }
    return out;
  }, [composed, locationSpec, includeArea, patchRadius]);

  const exits = useMemo(() => {
    const list: Array<{ exit: Exit; x: number; z: number; source: "location" | "area" }> = [];
    for (const exit of composed.sources.location?.exits ?? []) {
      list.push({
        exit,
        x: exit.x * patchRadius,
        z: exit.z * patchRadius,
        source: "location",
      });
    }
    if (includeArea && composed.sources.area) {
      for (const exit of composed.sources.area.exits) {
        list.push({
          exit,
          x: exit.x * patchRadius * 0.75,
          z: exit.z * patchRadius * 0.75,
          source: "area",
        });
      }
    }
    return list;
  }, [composed, includeArea, patchRadius]);

  return (
    <>
      {features.map((feature, i) => {
        const Template = getTemplate(feature.template as never);
        return (
          <Template
            key={`${feature.source}-${i}-${feature.template}`}
            position={[feature.x, 0, feature.z]}
            rotation={feature.rotation}
            scale={feature.scale}
            palette={palette}
            label={feature.label}
          />
        );
      })}
      {exits.map((entry, i) => {
        const wx = locationPosition[0] + entry.x;
        const wz = locationPosition[1] + entry.z;
        return (
          <ExitMarker
            key={`exit-${entry.source}-${i}`}
            exit={entry.exit}
            x={entry.x}
            z={entry.z}
            onClick={
              onExitClick ? () => onExitClick(locationId, entry.exit, wx, wz) : undefined
            }
          />
        );
      })}
    </>
  );
}

function ExitMarker({
  exit,
  x,
  z,
  onClick,
}: {
  exit: Exit;
  x: number;
  z: number;
  onClick?: () => void;
}) {
  const color =
    exit.kind === "doorway"
      ? "#fcd34d"
      : exit.kind === "portal"
        ? "#a78bfa"
        : exit.kind === "stair-up"
          ? "#86efac"
          : exit.kind === "stair-down"
            ? "#fca5a5"
            : "#94a3b8";
  const handleClick = (e: { stopPropagation: () => void }) => {
    if (!onClick) return;
    e.stopPropagation();
    onClick();
  };
  return (
    <group position={[x, 0, z]}>
      {/* Invisible hit disc gives a forgiving click target. */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.005, 0]}
        renderOrder={4}
        onClick={handleClick}
      >
        <circleGeometry args={[2.2, 32]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={5}
        onClick={handleClick}
      >
        <circleGeometry args={[1.4, 32]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.75}
          side={THREE.DoubleSide}
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-5}
          polygonOffsetUnits={-10}
        />
      </mesh>
    </group>
  );
}
