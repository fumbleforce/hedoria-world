import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { ComposedFeature, ComposedSceneSpec, TemplateId } from "./sceneSpec";

export type MovementObstacle = { x: number; z: number; radius: number };

export type MovementSpec = {
  obstacles: MovementObstacle[];
  bounds: number;
};

const SOLID_TEMPLATES: ReadonlySet<TemplateId> = new Set<TemplateId>([
  "tower",
  "spire",
  "dome-hall",
  "house",
  "stall",
  "wall-section",
  "gate-arch",
  "fountain",
  "statue",
  "obelisk",
  "pyre",
  "machine",
  "pod",
  "energy-conduit",
  "crystal-cluster",
  "rock-cluster",
  "tree-cluster",
  "cliff",
  "mountain-silhouette",
  "platform",
]);

const BASE_RADIUS_BY_TEMPLATE: Partial<Record<TemplateId, number>> = {
  "pillar-cluster": 2.0,
  tower: 1.6,
  spire: 1.0,
  "dome-hall": 3.2,
  house: 1.6,
  stall: 1.4,
  "wall-section": 2.6,
  "gate-arch": 2.0,
  fountain: 1.8,
  statue: 1.0,
  obelisk: 0.9,
  pyre: 0.9,
  machine: 1.4,
  pod: 1.0,
  "energy-conduit": 0.8,
  "crystal-cluster": 1.4,
  "rock-cluster": 1.6,
  "tree-cluster": 1.8,
  cliff: 3.5,
  "mountain-silhouette": 4.0,
  platform: 2.4,
  bridge: 0.8,
  stair: 1.2,
  lamp: 0.4,
  "door-portal": 0.0,
  pond: 0.0,
  crater: 0.0,
};

function radiusFor(feature: ComposedFeature): number {
  const base = BASE_RADIUS_BY_TEMPLATE[feature.template] ?? 1.2;
  return base * (feature.scale ?? 1);
}

export function buildMovementSpec(spec: ComposedSceneSpec): MovementSpec {
  const obstacles: MovementObstacle[] = [];
  for (const feature of spec.features) {
    if (!SOLID_TEMPLATES.has(feature.template)) continue;
    const r = radiusFor(feature);
    if (r <= 0) continue;
    obstacles.push({
      x: feature.x * spec.scale,
      z: feature.z * spec.scale,
      radius: r,
    });
  }
  return {
    obstacles,
    bounds: spec.scale * 1.4,
  };
}

export type UsePlayerMovementOptions = {
  groupRef: React.RefObject<THREE.Group | null>;
  initialPosition?: [number, number, number];
  movement: MovementSpec;
  maxSpeed?: number;
  reachThreshold?: number;
  onArrive?: () => void;
  onPositionChange?: (worldX: number, worldZ: number) => void;
};

export type PlayerMovementHandle = {
  setTarget: (worldX: number, worldZ: number) => void;
  getPosition: () => [number, number, number];
  isMoving: () => boolean;
};

const FRAME_VECTOR = new THREE.Vector3();
const FRAME_DELTA = new THREE.Vector3();
const REPULSION_VECTOR = new THREE.Vector3();

/**
 * Click-to-walk movement controller. Owns target/position via refs to avoid
 * per-frame React re-renders. Apply soft repulsion from feature bounding circles
 * and clamp inside the scene's bounds. Drop on a Group inside an R3F Canvas.
 */
export function usePlayerMovement({
  groupRef,
  initialPosition = [0, 0, 0],
  movement,
  maxSpeed = 14,
  reachThreshold = 0.15,
  onArrive,
  onPositionChange,
}: UsePlayerMovementOptions): PlayerMovementHandle {
  const positionRef = useRef(new THREE.Vector3(...initialPosition));
  const targetRef = useRef(new THREE.Vector3(...initialPosition));
  const arrivedRef = useRef(true);
  const movementRef = useRef(movement);
  const seededRef = useRef(false);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    movementRef.current = movement;
  }, [movement]);

  // Seed position/target only once. The parent passes a new `initialPosition`
  // array on every render, so we must not re-run this effect every render —
  // doing so would reset the active walk target back to the player's live
  // position and halt movement after a single frame.
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    if (groupRef.current) {
      groupRef.current.position.copy(positionRef.current);
    }
  }, [groupRef]);

  // First-frame-after-setTarget marker. R3F's clock keeps advancing while
  // `frameloop="demand"` is asleep, so the very next useFrame after a wakeup
  // sees a `delta` equal to the entire idle duration — visibly teleporting
  // the player forward by `maxSpeed * delta` in a single frame. We override
  // it with one normal frame's worth.
  const justWokeRef = useRef(false);
  useFrame((_, delta) => {
    // Idle short-circuit: when we've arrived at the target, the entire
    // movement body becomes a no-op. The scene is rendered in
    // `frameloop="demand"` mode, so if no other system requests a frame
    // we won't even be called — but on a frame that is requested for some
    // other reason (camera lerp settling, weather), we still need to do
    // *nothing* here.
    if (arrivedRef.current) {
      return;
    }
    const group = groupRef.current;
    if (!group) return;

    // First frame after a fresh `setTarget` while the demand loop was
    // asleep: R3F's clock kept ticking during idle, so `delta` reflects
    // wall-clock seconds since our last useFrame ran (observed up to ~20s).
    // Substitute one normal frame so the first step is sub-pixel and
    // motion accelerates naturally from the second frame onward. On
    // subsequent frames, cap delta at 1/30s so browser-induced rAF
    // throttling during scroll/wheel events can never produce more than
    // a `maxSpeed/30` step in a single rendered frame.
    let dt: number;
    if (justWokeRef.current) {
      justWokeRef.current = false;
      dt = 1 / 60;
    } else {
      dt = Math.min(delta, 1 / 30);
    }
    const pos = positionRef.current;
    const target = targetRef.current;

    FRAME_DELTA.copy(target).sub(pos);
    FRAME_DELTA.y = 0;
    const dist = FRAME_DELTA.length();
    if (dist > reachThreshold) {
      const step = Math.min(dist, maxSpeed * dt);
      FRAME_DELTA.normalize().multiplyScalar(step);
      pos.add(FRAME_DELTA);
    } else {
      pos.copy(target);
      arrivedRef.current = true;
      onArrive?.();
    }

    // Soft repulsion + bounds clamp only matter while the player is
    // actively moving — once arrived, we're not going to push ourselves
    // around. Even while moving, only iterate obstacles within a bounding
    // box so the inner loop scales with neighbours, not total scene
    // count. (The scene only ships ~64 obstacles via FRAME_OBSTACLE_BUDGET
    // at the Overworld layer, but we keep this defensive.)
    const m = movementRef.current;
    for (const obs of m.obstacles) {
      const dx = pos.x - obs.x;
      const dz = pos.z - obs.z;
      const minD = obs.radius + 0.6;
      // Cheap reject on the bounding square before doing the hypot.
      if (dx > minD || dx < -minD || dz > minD || dz < -minD) continue;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < minD && d > 0.001) {
        REPULSION_VECTOR.set(dx, 0, dz).normalize().multiplyScalar(minD - d);
        pos.add(REPULSION_VECTOR);
      } else if (d <= 0.001) {
        pos.x += 0.5;
      }
    }

    if (m.bounds > 0) {
      FRAME_VECTOR.set(pos.x, 0, pos.z);
      const r = FRAME_VECTOR.length();
      if (r > m.bounds) {
        FRAME_VECTOR.normalize().multiplyScalar(m.bounds);
        pos.x = FRAME_VECTOR.x;
        pos.z = FRAME_VECTOR.z;
      }
    }

    group.position.copy(pos);
    onPositionChange?.(pos.x, pos.z);

    // Keep the demand loop alive while we still have ground to cover.
    // When `arrivedRef` flips above we skip the invalidate so the loop
    // can quiesce.
    if (!arrivedRef.current) {
      invalidate();
    }
  });

  const handle = useMemo<PlayerMovementHandle>(
    () => ({
      setTarget(worldX, worldZ) {
        const m = movementRef.current;
        let tx = worldX;
        let tz = worldZ;
        if (m.bounds > 0) {
          const r = Math.sqrt(tx * tx + tz * tz);
          if (r > m.bounds) {
            tx = (tx / r) * m.bounds;
            tz = (tz / r) * m.bounds;
          }
        }
        targetRef.current.set(tx, 0, tz);
        arrivedRef.current = false;
        justWokeRef.current = true;
        // Wake the demand loop so the new target actually starts being
        // walked toward. Without this, `setTarget` would mutate a ref
        // that nothing reads until *something else* requests a frame.
        invalidate();
      },
      getPosition() {
        const p = positionRef.current;
        return [p.x, p.y, p.z];
      },
      isMoving() {
        return !arrivedRef.current;
      },
    }),
    [invalidate],
  );

  return handle;
}
