import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useGameStore } from "../state/store";
import { LodBroker } from "./LocationProxy";
import {
  composeSceneSpec,
  isInteriorArchetype,
  type ComposedSceneSpec,
  type Exit,
  type Lighting,
  type SceneSpec,
  type Sky,
  type Surface,
} from "./sceneSpec";
import type { SceneCache } from "./sceneCache";
import {
  buildMovementSpec,
  usePlayerMovement,
  type MovementObstacle,
  type MovementSpec,
  type PlayerMovementHandle,
} from "./movement";
import { LocationProxy } from "./LocationProxy";
import { getTemplate } from "./templates";
import {
  computeWorldLayout,
  findProximity,
  prefetchNearby,
  type WorldLayout,
  type WorldLayoutRegion,
} from "./sceneTransition";
import type { PackData } from "../schema/packSchema";

export type OverworldProps = {
  pack: PackData;
  cache: SceneCache;
  initialPlayerPos?: [number, number];
  onPlayerPosChange?: (x: number, z: number) => void;
  onNearestLocationChange?: (locationId: string | null) => void;
  onCurrentRegionChange?: (regionId: string | null) => void;
  onExitInterior?: (info: { locationId: string; areaId: string; exit: Exit }) => void;
  /** Optional render override for NPC billboards (passed the current location id). */
  renderNpcsForLocation?: (locationId: string) => React.ReactNode;
  playerLabel?: string;
};

const FRAME_OBSTACLE_BUDGET = 64;

function lightingFromSpec(spec: ComposedSceneSpec): {
  ambient: { color: string; intensity: number };
  directional: { color: string; intensity: number; position: [number, number, number] };
  hemisphereSky: string;
  hemisphereGround: string;
  hemisphereIntensity: number;
} {
  const lighting: Lighting = spec.lighting;
  const sky: Sky = spec.sky;
  const surface: Surface = spec.surface;
  const interior = isInteriorArchetype(spec.archetype);
  const baseSky = sky.palette[0] ?? "#9bc1ee";
  const baseGround = surface.palette[0] ?? "#7a7a7a";
  const intensityMul = 0.4 + lighting.intensity * 0.9;
  switch (lighting.primary) {
    case "sun-warm":
      return {
        ambient: { color: "#fff5d8", intensity: 0.45 * intensityMul },
        directional: { color: "#fff1c2", intensity: 1.1 * intensityMul, position: [120, 200, 80] },
        hemisphereSky: baseSky,
        hemisphereGround: baseGround,
        hemisphereIntensity: 0.45 * intensityMul,
      };
    case "sun-cool":
      return {
        ambient: { color: "#dde8ff", intensity: 0.45 * intensityMul },
        directional: { color: "#cfdcff", intensity: 1.0 * intensityMul, position: [120, 200, 80] },
        hemisphereSky: baseSky,
        hemisphereGround: baseGround,
        hemisphereIntensity: 0.45 * intensityMul,
      };
    case "moon":
      return {
        ambient: { color: "#9fb4ff", intensity: 0.3 * intensityMul },
        directional: { color: "#a7b8ff", intensity: 0.55 * intensityMul, position: [-90, 180, -70] },
        hemisphereSky: baseSky,
        hemisphereGround: baseGround,
        hemisphereIntensity: 0.3 * intensityMul,
      };
    case "torch":
      return {
        ambient: { color: "#3a2418", intensity: 0.25 * intensityMul },
        directional: { color: "#ffb070", intensity: 0.7 * intensityMul, position: [40, 80, 40] },
        hemisphereSky: "#3a2418",
        hemisphereGround: baseGround,
        hemisphereIntensity: 0.2 * intensityMul,
      };
    case "neon":
      return {
        ambient: { color: "#1a1230", intensity: 0.25 * intensityMul },
        directional: { color: "#a36bff", intensity: 0.55 * intensityMul, position: [60, 140, 60] },
        hemisphereSky: "#3b1f60",
        hemisphereGround: baseGround,
        hemisphereIntensity: 0.55 * intensityMul,
      };
    case "bioluminescent":
      return {
        ambient: { color: "#1f3a55", intensity: 0.3 * intensityMul },
        directional: { color: "#7be9ff", intensity: 0.4 * intensityMul, position: [60, 120, 60] },
        hemisphereSky: "#1d4b6b",
        hemisphereGround: baseGround,
        hemisphereIntensity: 0.45 * intensityMul,
      };
    case "ambient-only":
    default:
      return {
        ambient: { color: interior ? "#9aa0a6" : baseSky, intensity: 0.85 * intensityMul },
        directional: { color: "#ffffff", intensity: 0.0, position: [0, 100, 0] },
        hemisphereSky: baseSky,
        hemisphereGround: baseGround,
        hemisphereIntensity: 0.4 * intensityMul,
      };
  }
}

// Camera framing tuned for a Baldur's Gate-style isometric feel: the camera
// sits ~25u back/up from the player so the avatar fills a comfortable portion
// of the screen regardless of how big the overworld is. Baselines chosen so
// a default 16u location patch fits the screen with some breathing room.
// Mouse-wheel zoom multiplies these. Middle-mouse drag rotates the camera
// around the player by adjusting `cameraAzimuthRef`.
const CAMERA_OFFSET = 22;
const CAMERA_HEIGHT = 28;
// Horizontal distance from player to camera in the XZ plane. At the default
// 45° azimuth this gives a (CAMERA_OFFSET, CAMERA_OFFSET) world offset, which
// matches the original fixed-camera framing exactly.
const CAMERA_HORIZ = CAMERA_OFFSET * Math.SQRT2;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 12;
const ZOOM_STEP = 0.15;
// Sensitivity of middle-mouse rotation, in radians per pixel of horizontal
// drag. ~0.005 rad/px ≈ 0.29°/px → a 350px drag does a full 90° turn, which
// feels natural for a trackball-style yaw.
const ROTATE_RAD_PER_PIXEL = 0.005;

function CameraRig({
  followRef,
  zoomRef,
  azimuthRef,
}: {
  followRef: React.RefObject<THREE.Group | null>;
  zoomRef: React.RefObject<number>;
  azimuthRef: React.RefObject<number>;
}) {
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const desired = useRef(new THREE.Vector3());
  const lookAt = useRef(new THREE.Vector3());
  useFrame(() => {
    const group = followRef.current;
    if (!group) return;
    const zoom = zoomRef.current;
    const az = azimuthRef.current;
    // Polar offset around the player: camera sits at distance R in the XZ
    // plane at angle `az` (measured clockwise from world -Z = "south").
    const horiz = CAMERA_HORIZ * zoom;
    desired.current.set(
      group.position.x + Math.sin(az) * horiz,
      CAMERA_HEIGHT * zoom,
      group.position.z + Math.cos(az) * horiz,
    );
    lookAt.current.set(group.position.x, 0, group.position.z);
    const dist = camera.position.distanceTo(desired.current);
    camera.position.lerp(desired.current, 0.12);
    camera.lookAt(lookAt.current);
    // Keep the demand-driven loop alive until the camera is settled. Once we
    // reach the desired pose we stop requesting frames so the GPU + CPU go
    // quiet whenever nothing is actually changing.
    if (dist > 0.05) {
      invalidate();
    }
  });
  return null;
}

/** Captures this Canvas's `invalidate` into a parent ref so non-Canvas
 *  handlers (mouse rotate, wheel zoom, etc.) can wake the demand loop. */
function InvalidateBridge({
  invalidateRef,
}: {
  invalidateRef: React.RefObject<(() => void) | null>;
}) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    invalidateRef.current = invalidate;
    return () => {
      invalidateRef.current = null;
    };
  }, [invalidate, invalidateRef]);
  return null;
}

function SkyDome({ sky }: { sky: Sky }) {
  const top = sky.palette[0] ?? "#9bc1ee";
  const mid = sky.palette[1] ?? top;
  const bot = sky.palette[2] ?? mid;
  const blendColor = useMemo(() => {
    const ca = hexToRgb(top);
    const cb = hexToRgb(bot);
    return rgbToHex([
      ca[0] + (cb[0] - ca[0]) * 0.5,
      ca[1] + (cb[1] - ca[1]) * 0.5,
      ca[2] + (cb[2] - ca[2]) * 0.5,
    ]);
  }, [top, bot]);
  return (
    <>
      <color attach="background" args={[blendColor]} />
      <mesh position={[0, 0, 0]}>
        <sphereGeometry args={[1200, 32, 16]} />
        <meshBasicMaterial color={blendColor} side={THREE.BackSide} />
      </mesh>
      <mesh position={[0, 600, 0]}>
        <sphereGeometry args={[600, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshBasicMaterial color={top} side={THREE.BackSide} transparent opacity={0.55} />
      </mesh>
    </>
  );
}

function GroundLayer({
  layout,
  fallbackSurface,
  regionSurfaces,
  worldRadius,
  onClick,
}: {
  layout: WorldLayout;
  fallbackSurface: Surface;
  regionSurfaces: Record<string, Surface>;
  worldRadius: number;
  onClick: (worldX: number, worldZ: number) => void;
}) {
  const baseColor = fallbackSurface.palette[0] ?? "#7a7a7a";
  const planeSize = Math.max(400, worldRadius * 4);
  return (
    <group>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
        onClick={(e) => {
          e.stopPropagation();
          onClick(e.point.x, e.point.z);
        }}
      >
        <planeGeometry args={[planeSize, planeSize]} />
        <meshStandardMaterial color={baseColor} roughness={0.95} />
      </mesh>
      {layout.regions.map((region) => {
        const surface = regionSurfaces[region.id] ?? fallbackSurface;
        const color = surface.palette[0] ?? baseColor;
        const accent = surface.palette[1] ?? color;
        return (
          <RegionCell
            key={region.id}
            region={region}
            cellSize={layout.unitsPerRegionGrid}
            color={color}
            accent={accent}
          />
        );
      })}
    </group>
  );
}

function RegionCell({
  region,
  cellSize,
  color,
  accent,
}: {
  region: WorldLayoutRegion;
  cellSize: number;
  color: string;
  accent: string;
}) {
  // Outline geometry: 4 line segments around the cell perimeter, slightly
  // inset so adjacent cells don't share an edge that double-draws.
  const outlinePoints = useMemo(() => {
    const half = cellSize * 0.5 - 0.5;
    return new Float32Array([
      -half, 0, -half,
      half, 0, -half,
      half, 0, -half,
      half, 0, half,
      half, 0, half,
      -half, 0, half,
      -half, 0, half,
      -half, 0, -half,
    ]);
  }, [cellSize]);

  return (
    <group position={[region.position[0], 0, region.position[1]]}>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
        renderOrder={1}
      >
        <planeGeometry args={[cellSize, cellSize]} />
        <meshStandardMaterial
          color={color}
          roughness={0.95}
          polygonOffset
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-2}
        />
      </mesh>
      <lineSegments renderOrder={2}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[outlinePoints, 3]}
            count={outlinePoints.length / 3}
          />
        </bufferGeometry>
        <lineBasicMaterial
          color={accent}
          transparent
          opacity={0.45}
          depthWrite={false}
        />
      </lineSegments>
    </group>
  );
}

function RegionAmbientFeatures({
  regions,
  regionSpecs,
}: {
  regions: WorldLayoutRegion[];
  regionSpecs: Record<string, SceneSpec>;
}) {
  const featureNodes = useMemo(() => {
    const out: Array<{
      key: string;
      template: string;
      position: [number, number, number];
      rotation?: number;
      scale: number;
      palette: string[];
      label?: string;
    }> = [];
    for (const region of regions) {
      const spec = regionSpecs[region.id];
      if (!spec) continue;
      const palette = spec.surface?.palette ?? ["#7a7a7a"];
      const r = region.radius;
      for (let i = 0; i < spec.features.length; i += 1) {
        const feature = spec.features[i];
        const wx = region.position[0] + feature.x * r * 0.85;
        const wz = region.position[1] + feature.z * r * 0.85;
        out.push({
          key: `${region.id}-${i}-${feature.template}`,
          template: feature.template,
          position: [wx, 0, wz],
          rotation: feature.rotation,
          scale: (feature.scale ?? 1) * 1.3,
          palette,
          label: feature.label,
        });
      }
    }
    return out;
  }, [regions, regionSpecs]);

  return (
    <>
      {featureNodes.map((node) => {
        const Template = getTemplate(node.template as never);
        return (
          <Template
            key={node.key}
            position={node.position}
            rotation={node.rotation}
            scale={node.scale}
            palette={node.palette}
            label={node.label}
          />
        );
      })}
    </>
  );
}

type PlayerControllerProps = {
  groupRef: React.RefObject<THREE.Group | null>;
  initialPosition: [number, number, number];
  movement: MovementSpec;
  label?: string;
  onPositionChange?: (x: number, z: number) => void;
  onHandle?: (handle: PlayerMovementHandle | null) => void;
};

function PlayerController({
  groupRef,
  initialPosition,
  movement,
  label,
  onPositionChange,
  onHandle,
}: PlayerControllerProps) {
  const handle = usePlayerMovement({
    groupRef,
    initialPosition,
    movement,
    onPositionChange,
  });
  useEffect(() => {
    onHandle?.(handle);
    return () => onHandle?.(null);
  }, [handle, onHandle]);
  return (
    <group ref={groupRef} position={initialPosition}>
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={6}>
        <ringGeometry args={[0.6, 0.85, 24]} />
        <meshBasicMaterial
          color="#facc15"
          transparent
          opacity={0.85}
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-6}
          polygonOffsetUnits={-12}
        />
      </mesh>
      <mesh position={[0, 0.9, 0]} castShadow>
        <capsuleGeometry args={[0.35, 0.9, 4, 10]} />
        <meshStandardMaterial color="#f7c948" roughness={0.6} />
      </mesh>
      <mesh position={[0, 1.85, 0]} castShadow>
        <sphereGeometry args={[0.27, 12, 10]} />
        <meshStandardMaterial color="#ffe1a8" roughness={0.7} />
      </mesh>
      {label ? null : null}
    </group>
  );
}

type OverworldContentProps = OverworldProps & {
  zoomRef: React.RefObject<number>;
  azimuthRef: React.RefObject<number>;
  invalidateRef: React.RefObject<(() => void) | null>;
};

function OverworldContent({
  pack,
  cache,
  initialPlayerPos,
  onPlayerPosChange,
  onNearestLocationChange,
  onCurrentRegionChange,
  onExitInterior,
  renderNpcsForLocation,
  playerLabel,
  zoomRef,
  azimuthRef,
  invalidateRef,
}: OverworldContentProps) {
  const layout = useMemo(() => computeWorldLayout(pack), [pack]);
  const playerGroupRef = useRef<THREE.Group | null>(null);
  const handleRef = useRef<PlayerMovementHandle | null>(null);

  const initialPos: [number, number] = initialPlayerPos ?? [
    layout.locations[0]?.position[0] ?? 0,
    layout.locations[0]?.position[1] ?? 0,
  ];

  // Live player position lives in a ref (not React state) so 114 location
  // patches don't re-reconcile every frame. The single useFrame below
  // distributes the position to the LoD broker + proximity logic, gated on
  // *whether the player actually moved this frame* — when the player is
  // still and the camera is settled, this body short-circuits and no work
  // happens at all.
  const playerPosRef = useRef<[number, number]>([...initialPos] as [number, number]);
  // One LoD broker for the whole overworld. Each LocationProxy subscribes
  // once on mount; we update it in a single pass per moved frame instead
  // of running 114 useFrames in parallel. Seed it with the initial player
  // position so first-mount subscribers compute their LoD against the
  // right reference point (otherwise they'd briefly show "near" detail
  // for whatever location is closest to world origin (0,0)).
  const lodBrokerRef = useRef<LodBroker>(null);
  if (lodBrokerRef.current === null) {
    lodBrokerRef.current = new LodBroker();
    lodBrokerRef.current.update(initialPos[0], initialPos[1]);
  }
  const lodBroker = lodBrokerRef.current;

  const [, setProximityVersion] = useState(0);
  const lastNearestRef = useRef<string | null>(null);
  const lastRegionRef = useRef<string | null>(null);
  const lastPrefetchTimeRef = useRef(0);
  const lastPersistTimeRef = useRef(0);
  const currentRegionIdRef = useRef<string | null>(null);
  const lastFramePosRef = useRef<[number, number]>([Number.NaN, Number.NaN]);

  const [, setSpecVersion] = useState(0);

  useEffect(() => {
    return cache.subscribeToSpec(() => {
      setSpecVersion((v) => v + 1);
      // Spec resolved → wake the demand loop so the new spec actually
      // renders even if the player is standing still.
      invalidateRef.current?.();
    });
  }, [cache, invalidateRef]);

  // Initial proximity computation so HUD shows correct region/location at
  // boot before the player has moved.
  const initialProximity = useMemo(
    () => findProximity(layout, initialPos),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layout],
  );
  if (currentRegionIdRef.current === null) {
    currentRegionIdRef.current = initialProximity.currentRegion?.id ?? null;
    lastRegionRef.current = currentRegionIdRef.current;
    lastNearestRef.current = initialProximity.containingLocation?.id ?? null;
    onNearestLocationChange?.(lastNearestRef.current);
    onCurrentRegionChange?.(lastRegionRef.current);
  }

  useFrame(() => {
    const pos = playerPosRef.current;
    if (pos[0] === lastFramePosRef.current[0] && pos[1] === lastFramePosRef.current[1]) {
      // Player hasn't moved since the last frame this useFrame ran. Other
      // frame consumers (camera lerp settling, weather particles) may have
      // requested this frame; we just don't have any work to do.
      return;
    }
    lastFramePosRef.current[0] = pos[0];
    lastFramePosRef.current[1] = pos[1];

    lodBroker.update(pos[0], pos[1]);

    const result = findProximity(layout, pos);
    const nextNearest = result.containingLocation?.id ?? null;
    const nextRegion = result.currentRegion?.id ?? null;
    let dirty = false;
    if (nextNearest !== lastNearestRef.current) {
      lastNearestRef.current = nextNearest;
      onNearestLocationChange?.(nextNearest);
      dirty = true;
    }
    if (nextRegion !== lastRegionRef.current) {
      lastRegionRef.current = nextRegion;
      currentRegionIdRef.current = nextRegion;
      onCurrentRegionChange?.(nextRegion);
      dirty = true;
    }
    if (dirty) {
      setProximityVersion((v) => v + 1);
    }

    // Throttled persistence and prefetch — these don't need 60Hz fidelity.
    const now = performance.now();
    if (now - lastPersistTimeRef.current > 250) {
      lastPersistTimeRef.current = now;
      onPlayerPosChange?.(pos[0], pos[1]);
    }
    if (now - lastPrefetchTimeRef.current > 600) {
      lastPrefetchTimeRef.current = now;
      prefetchNearby(layout, pos, cache, pack);
    }
  });

  // PASSIVE wide pass: builds a spec for every region/location in the world
  // so the overworld renders immediately. Distant scopes get the procedural
  // placeholder; LLM classify is reserved for the focus scope and the
  // distance-bounded `prefetchNearby` pump that runs as the player moves.
  // Without `passive: true`, hedoria's ~500-location boot would burst ~500
  // Gemini calls in one frame and blow through the free-tier rate limit.
  const regionSpecs = useMemo(() => {
    const out: Record<string, SceneSpec> = {};
    for (const region of layout.regions) {
      out[region.id] = cache.getRegionSpec(region.id, region.basicInfo, undefined, {
        passive: true,
      }).spec;
    }
    return out;
  }, [layout.regions, cache]);

  const locationComposed = useMemo(() => {
    const out: Record<string, ComposedSceneSpec> = {};
    for (const location of layout.locations) {
      const region = regionSpecs[location.regionId];
      if (!region) continue;
      const locSpec = cache.getLocationSpec(
        location.regionId,
        location.id,
        location.raw.basicInfo,
        undefined,
        { passive: true },
      ).spec;
      out[location.id] = composeSceneSpec({ region, location: locSpec });
    }
    return out;
  }, [layout.locations, regionSpecs, cache]);

  // Run prefetchNearby once at mount so the player's region + adjacent
  // locations get classified eagerly even before they start moving. The
  // useFrame body below also prefetches as the player walks; this just
  // covers the "stand still at boot" case.
  useEffect(() => {
    prefetchNearby(layout, [initialPos[0], initialPos[1]], cache, pack);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cache, pack]);

  const currentRegionId = currentRegionIdRef.current ?? layout.regions[0]?.id ?? null;
  const composedRegion = useMemo<ComposedSceneSpec | null>(() => {
    if (!currentRegionId) return null;
    const region = regionSpecs[currentRegionId];
    if (!region) return null;
    return composeSceneSpec({ region });
  }, [currentRegionId, regionSpecs]);

  const lighting = useMemo(() => {
    if (!composedRegion) return null;
    return lightingFromSpec(composedRegion);
  }, [composedRegion]);

  const fallbackSurface: Surface = useMemo(() => {
    return (
      composedRegion?.surface ?? {
        material: "earth",
        condition: "worn",
        palette: ["#5a6f3a", "#3f5a26", "#82994a"],
      }
    );
  }, [composedRegion]);

  const regionSurfaces = useMemo(() => {
    const out: Record<string, Surface> = {};
    for (const region of layout.regions) {
      const spec = regionSpecs[region.id];
      if (spec?.surface) out[region.id] = spec.surface;
    }
    return out;
  }, [layout.regions, regionSpecs]);

  const movement: MovementSpec = useMemo(() => {
    const obstacles: MovementObstacle[] = [];
    for (const location of layout.locations) {
      const composed = locationComposed[location.id];
      if (!composed) continue;
      const local = buildMovementSpec({
        ...composed,
        scale: location.patchRadius,
      });
      for (const obs of local.obstacles) {
        if (obstacles.length >= FRAME_OBSTACLE_BUDGET) break;
        obstacles.push({
          x: location.position[0] + obs.x,
          z: location.position[1] + obs.z,
          radius: obs.radius,
        });
      }
      if (obstacles.length >= FRAME_OBSTACLE_BUDGET) break;
    }
    return {
      obstacles,
      bounds: layout.worldRadius * 1.5,
    };
  }, [layout, locationComposed]);

  // Pending portal: when the player clicks a doorway/portal far away, we
  // remember it here and walk them over. Once the player gets within
  // PORTAL_TRIGGER_RADIUS of the portal's world position, we auto-fire the
  // interior transition. This prevents teleport-from-anywhere clicks while
  // keeping the UX one-click ("walk to that door and use it").
  type PendingPortal = {
    locationId: string;
    exit: Exit;
    worldX: number;
    worldZ: number;
  };
  const pendingPortalRef = useRef<PendingPortal | null>(null);
  const PORTAL_TRIGGER_RADIUS = 2.5;

  function fireExit(p: PendingPortal) {
    pendingPortalRef.current = null;
    if (
      (p.exit.kind === "doorway" || p.exit.kind === "portal" ||
        p.exit.kind === "stair-up" || p.exit.kind === "stair-down") &&
      p.exit.toAreaId
    ) {
      onExitInterior?.({
        locationId: p.exit.toLocationId ?? p.locationId,
        areaId: p.exit.toAreaId,
        exit: p.exit,
      });
    }
  }

  function handleGroundClick(worldX: number, worldZ: number) {
    pendingPortalRef.current = null;
    handleRef.current?.setTarget(worldX, worldZ);
  }

  function handlePlayerMovement(x: number, z: number) {
    // Hot-path: keep this allocation-free and React-state-free.
    // The shared playerPosRef is what children read every frame.
    playerPosRef.current[0] = x;
    playerPosRef.current[1] = z;
    const pending = pendingPortalRef.current;
    if (pending) {
      const dx = x - pending.worldX;
      const dz = z - pending.worldZ;
      if (Math.hypot(dx, dz) <= PORTAL_TRIGGER_RADIUS) {
        fireExit(pending);
      }
    }
  }

  function handleHandle(handle: PlayerMovementHandle | null) {
    handleRef.current = handle;
  }

  function handleLocationExit(
    locationId: string,
    exit: Exit,
    worldX: number,
    worldZ: number,
  ) {
    const dx = playerPosRef.current[0] - worldX;
    const dz = playerPosRef.current[1] - worldZ;
    const close = Math.hypot(dx, dz) <= PORTAL_TRIGGER_RADIUS;
    const pending: PendingPortal = { locationId, exit, worldX, worldZ };
    if (close) {
      fireExit(pending);
      return;
    }
    pendingPortalRef.current = pending;
    handleRef.current?.setTarget(worldX, worldZ);
  }

  // Stable callback identities for memoised children. The function
  // declarations above are recreated on every OverworldContent render, which
  // would invalidate React.memo on LocationProxy and force all 114 patches
  // to reconcile. The actual handlers all dispatch through refs and Zustand
  // setters, so a "ref-redirected" stable wrapper is fully correct: the
  // wrapper's identity is frozen for the component's lifetime, and each
  // call hits the latest impl via `*Ref.current`.
  const handleLocationExitRef = useRef(handleLocationExit);
  handleLocationExitRef.current = handleLocationExit;
  const handleGroundClickRef = useRef(handleGroundClick);
  handleGroundClickRef.current = handleGroundClick;

  const stableOnExitClick = useCallback(
    (locId: string, exit: Exit, wx: number, wz: number) => {
      handleLocationExitRef.current(locId, exit, wx, wz);
    },
    [],
  );
  const stableOnGroundClick = useCallback((wx: number, wz: number) => {
    handleGroundClickRef.current(wx, wz);
  }, []);

  if (!composedRegion || !lighting) {
    return null;
  }

  return (
    <>
      <InvalidateBridge invalidateRef={invalidateRef} />
      <CameraRig followRef={playerGroupRef} zoomRef={zoomRef} azimuthRef={azimuthRef} />
      <SkyDome sky={composedRegion.sky} />
      <ambientLight color={lighting.ambient.color} intensity={lighting.ambient.intensity} />
      {lighting.directional.intensity > 0 ? (
        <directionalLight
          color={lighting.directional.color}
          intensity={lighting.directional.intensity}
          position={lighting.directional.position}
          castShadow
        />
      ) : null}
      <hemisphereLight
        args={[lighting.hemisphereSky, lighting.hemisphereGround, lighting.hemisphereIntensity]}
      />
      <fog
        attach="fog"
        args={[composedRegion.sky.palette[0] ?? "#cccccc", 60, layout.worldRadius * 2.5]}
      />

      <GroundLayer
        layout={layout}
        fallbackSurface={fallbackSurface}
        regionSurfaces={regionSurfaces}
        worldRadius={layout.worldRadius}
        onClick={stableOnGroundClick}
      />

      <RegionAmbientFeatures regions={layout.regions} regionSpecs={regionSpecs} />

      {layout.locations.map((location) => (
        <LocationProxy
          key={location.id}
          locationId={location.id}
          position={location.position}
          composed={locationComposed[location.id]}
          locationSpec={cache.peek({
            scope: "location",
            ids: { regionId: location.regionId, locationId: location.id },
            prose: location.raw.basicInfo,
          })?.spec}
          patchRadius={location.patchRadius}
          label={location.name}
          lodBroker={lodBroker}
          onExitClick={stableOnExitClick}
        >
          {renderNpcsForLocation?.(location.id)}
        </LocationProxy>
      ))}

      <PlayerController
        groupRef={playerGroupRef}
        initialPosition={[initialPos[0], 0, initialPos[1]]}
        movement={movement}
        label={playerLabel}
        onPositionChange={handlePlayerMovement}
        onHandle={handleHandle}
      />
    </>
  );
}

export function Overworld(props: OverworldProps) {
  const layout = useMemo(() => computeWorldLayout(props.pack), [props.pack]);
  const startX = props.initialPlayerPos?.[0] ?? layout.locations[0]?.position[0] ?? 0;
  const startZ = props.initialPlayerPos?.[1] ?? layout.locations[0]?.position[1] ?? 0;
  const zoomRef = useRef(1);
  const [zoomDisplay, setZoomDisplay] = useState(1);

  // Camera azimuth: live ref for per-frame camera reads, plus a throttled
  // mirror in the Zustand store so the compass can subscribe and rotate
  // without forcing the heavy 3D scene to rerender.
  const initialAzimuth = useGameStore.getState().cameraAzimuth;
  const azimuthRef = useRef(initialAzimuth);
  const setStoreAzimuth = useGameStore((s) => s.setCameraAzimuth);
  const sceneRootRef = useRef<HTMLDivElement | null>(null);
  // Captured by <InvalidateBridge> on Canvas mount. Used by non-Canvas
  // event handlers (wheel zoom, middle-mouse rotate) to wake the demand
  // frame loop after they mutate camera-related refs.
  const invalidateRef = useRef<(() => void) | null>(null);

  function handleWheel(e: React.WheelEvent<HTMLDivElement>) {
    // Wheel down (positive deltaY) zooms out; wheel up zooms in.
    const direction = e.deltaY > 0 ? 1 : -1;
    const next = clamp(zoomRef.current * (1 + direction * ZOOM_STEP), ZOOM_MIN, ZOOM_MAX);
    zoomRef.current = next;
    setZoomDisplay(next);
    invalidateRef.current?.();
  }

  // Middle-mouse rotate. We attach the mousedown listener natively (rather
  // than via React's onMouseDown) because Linux Firefox's middle-click
  // autoscroll only honours `preventDefault` when called on a *non-passive*
  // listener — React's synthetic events delegate from the document root and
  // don't always block it in time. Once the drag is active we listen on
  // window so the user can drag past the canvas edge without losing focus.
  useEffect(() => {
    const root = sceneRootRef.current;
    if (!root) return;

    let dragging = false;
    let lastX = 0;
    let lastSyncMs = 0;

    function syncStore(force = false) {
      const now = performance.now();
      if (!force && now - lastSyncMs < 33) return; // ~30Hz update for compass
      lastSyncMs = now;
      setStoreAzimuth(azimuthRef.current);
    }

    function onMove(ev: MouseEvent) {
      if (!dragging) return;
      const dx = ev.clientX - lastX;
      lastX = ev.clientX;
      azimuthRef.current += dx * ROTATE_RAD_PER_PIXEL;
      syncStore();
      // Wake the demand-driven render loop so the camera rig actually
      // animates the rotation. Without this, `azimuthRef.current` would
      // change but no frame would be requested while the player stands
      // still.
      invalidateRef.current?.();
    }

    function onUp(ev: MouseEvent) {
      if (!dragging || ev.button !== 1) return;
      dragging = false;
      syncStore(true);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }

    function onDown(ev: MouseEvent) {
      if (ev.button !== 1) return; // middle button only
      ev.preventDefault(); // suppress Linux/Firefox autoscroll
      dragging = true;
      lastX = ev.clientX;
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    }

    // `passive: false` is required so preventDefault() actually blocks the
    // browser's default middle-button behaviour.
    root.addEventListener("mousedown", onDown, { passive: false });
    return () => {
      root.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [setStoreAzimuth]);

  // Compute the initial camera placement from the azimuth so the *very
  // first frame* matches whatever the user (or saved state) set, not a
  // hard-coded 45°.
  const initialCamX = startX + Math.sin(initialAzimuth) * CAMERA_HORIZ;
  const initialCamZ = startZ + Math.cos(initialAzimuth) * CAMERA_HORIZ;

  return (
    <div className="sceneRoot" ref={sceneRootRef} onWheel={handleWheel}>
      <Canvas
        // PCFSoftShadowMap (R3F's default for `shadows`) was deprecated in
        // three.js and prints a console warning every frame. PCF shadows
        // also struggle with our 114-location overworld. We pick the
        // hard-edged "basic" shadow type, which is the fastest variant
        // three.js still ships and is silent.
        shadows="basic"
        // Demand-driven render loop. R3F only redraws when something calls
        // `invalidate()`. While the player is standing still and the
        // camera is settled, the GPU + CPU stay idle (silent fan). Movement
        // / camera lerp / rotate / zoom each request frames as long as
        // they have work to do. See PRINCIPLES.md.
        frameloop="demand"
        camera={{
          position: [initialCamX, CAMERA_HEIGHT, initialCamZ],
          fov: 45,
          near: 0.1,
          far: 2000,
        }}
        gl={{ antialias: true }}
        dpr={[1, 2]}
      >
        <OverworldContent
          {...props}
          zoomRef={zoomRef}
          azimuthRef={azimuthRef}
          invalidateRef={invalidateRef}
        />
      </Canvas>
      <div className="zoomBadge" aria-hidden="true">
        Zoom {zoomDisplay.toFixed(1)}×
      </div>
    </div>
  );
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return [0.5, 0.5, 0.5];
  const num = parseInt(m[1], 16);
  return [((num >> 16) & 0xff) / 255, ((num >> 8) & 0xff) / 255, (num & 0xff) / 255];
}

function rgbToHex(rgb: [number, number, number]): string {
  const [r, g, b] = rgb.map((c) => Math.max(0, Math.min(255, Math.round(c * 255))));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}
