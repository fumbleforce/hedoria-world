import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type {
  ComposedFeature,
  ComposedSceneSpec,
  Exit,
  Lighting,
  Sky,
  Surface,
} from "./sceneSpec";
import { isInteriorArchetype } from "./sceneSpec";
import { getTemplate } from "./templates";
import {
  buildMovementSpec,
  usePlayerMovement,
  type PlayerMovementHandle,
} from "./movement";

export type GroundClickInfo = {
  worldX: number;
  worldZ: number;
};

export type SceneRendererProps = {
  spec: ComposedSceneSpec;
  initialPlayerPosition?: [number, number, number];
  playerLabel?: string;
  onGroundClick?: (info: GroundClickInfo) => void;
  onExitClick?: (exit: Exit) => void;
  onPlayerPositionChange?: (x: number, z: number) => void;
  movementRef?: React.MutableRefObject<PlayerMovementHandle | null>;
  children?: React.ReactNode;
};

const GROUND_OVERSCALE = 4;

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

function lerpColor(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return rgbToHex([
    ca[0] + (cb[0] - ca[0]) * t,
    ca[1] + (cb[1] - ca[1]) * t,
    ca[2] + (cb[2] - ca[2]) * t,
  ]);
}

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
        directional: { color: "#fff1c2", intensity: 1.1 * intensityMul, position: [40, 60, 25] },
        hemisphereSky: baseSky,
        hemisphereGround: baseGround,
        hemisphereIntensity: 0.45 * intensityMul,
      };
    case "sun-cool":
      return {
        ambient: { color: "#dde8ff", intensity: 0.45 * intensityMul },
        directional: { color: "#cfdcff", intensity: 1.0 * intensityMul, position: [40, 60, 25] },
        hemisphereSky: baseSky,
        hemisphereGround: baseGround,
        hemisphereIntensity: 0.45 * intensityMul,
      };
    case "moon":
      return {
        ambient: { color: "#9fb4ff", intensity: 0.3 * intensityMul },
        directional: { color: "#a7b8ff", intensity: 0.55 * intensityMul, position: [-30, 50, -20] },
        hemisphereSky: baseSky,
        hemisphereGround: baseGround,
        hemisphereIntensity: 0.3 * intensityMul,
      };
    case "torch":
      return {
        ambient: { color: "#3a2418", intensity: 0.25 * intensityMul },
        directional: { color: "#ffb070", intensity: 0.7 * intensityMul, position: [10, 18, 10] },
        hemisphereSky: "#3a2418",
        hemisphereGround: baseGround,
        hemisphereIntensity: 0.2 * intensityMul,
      };
    case "neon":
      return {
        ambient: { color: "#1a1230", intensity: 0.25 * intensityMul },
        directional: { color: "#a36bff", intensity: 0.55 * intensityMul, position: [20, 40, 20] },
        hemisphereSky: "#3b1f60",
        hemisphereGround: baseGround,
        hemisphereIntensity: 0.55 * intensityMul,
      };
    case "bioluminescent":
      return {
        ambient: { color: "#1f3a55", intensity: 0.3 * intensityMul },
        directional: { color: "#7be9ff", intensity: 0.4 * intensityMul, position: [20, 30, 20] },
        hemisphereSky: "#1d4b6b",
        hemisphereGround: baseGround,
        hemisphereIntensity: 0.45 * intensityMul,
      };
    case "ambient-only":
    default:
      return {
        ambient: { color: interior ? "#9aa0a6" : baseSky, intensity: 0.85 * intensityMul },
        directional: { color: "#ffffff", intensity: 0.0, position: [0, 30, 0] },
        hemisphereSky: baseSky,
        hemisphereGround: baseGround,
        hemisphereIntensity: 0.4 * intensityMul,
      };
  }
}

// Match the Overworld's BG-style framing so interior sub-scenes don't drop
// the player far from the camera (interior scales are typically 8-18, so a
// 35/50 offset put the camera way outside the visible scene + fog far).
const INTERIOR_CAMERA_OFFSET = 18;
const INTERIOR_CAMERA_HEIGHT = 22;

function CameraRig({ followRef }: { followRef: React.RefObject<THREE.Group | null> }) {
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const desired = useRef(new THREE.Vector3());
  const lookAt = useRef(new THREE.Vector3());
  useFrame(() => {
    const group = followRef.current;
    if (!group) return;
    desired.current.set(
      group.position.x + INTERIOR_CAMERA_OFFSET,
      INTERIOR_CAMERA_HEIGHT,
      group.position.z + INTERIOR_CAMERA_OFFSET,
    );
    lookAt.current.set(group.position.x, 0, group.position.z);
    const dist = camera.position.distanceTo(desired.current);
    camera.position.lerp(desired.current, 0.12);
    camera.lookAt(lookAt.current);
    // Demand loop: keep frames coming until the camera is settled.
    if (dist > 0.05) invalidate();
  });
  return null;
}

type PlayerControllerProps = {
  groupRef: React.RefObject<THREE.Group | null>;
  initialPosition: [number, number, number];
  spec: ComposedSceneSpec;
  label?: string;
  onPositionChange?: (x: number, z: number) => void;
  onHandle?: (handle: PlayerMovementHandle | null) => void;
};

function PlayerController({
  groupRef,
  initialPosition,
  spec,
  label,
  onPositionChange,
  onHandle,
}: PlayerControllerProps) {
  const movement = useMemo(() => buildMovementSpec(spec), [spec]);
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
      {label ? (
        <Html distanceFactor={20} position={[0, 2.8, 0]} center zIndexRange={[10, 0]}>
          <div className="floatingLabel">{label}</div>
        </Html>
      ) : null}
    </group>
  );
}

function FeatureInstances({
  features,
  scale,
  surface,
}: {
  features: ComposedFeature[];
  scale: number;
  surface: Surface;
}) {
  return (
    <>
      {features.map((feature, i) => {
        const Template = getTemplate(feature.template);
        const wx = feature.x * scale;
        const wz = feature.z * scale;
        return (
          <Template
            key={`${feature.template}-${i}-${feature.x}-${feature.z}`}
            position={[wx, 0, wz]}
            rotation={feature.rotation}
            scale={feature.scale ?? 1}
            palette={surface.palette}
            materialOverride={feature.materialOverride}
            label={feature.label}
          />
        );
      })}
    </>
  );
}

function ExitMarker({ exit, scale, onClick }: { exit: Exit; scale: number; onClick?: () => void }) {
  const wx = exit.x * scale;
  const wz = exit.z * scale;
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
    <group position={[wx, 0, wz]}>
      {/* Invisible, generously-sized hit disc so the portal is forgiving to
          click. Sits just under the visible disc. */}
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

function Weather({
  spec,
  scale,
}: {
  spec: ComposedSceneSpec;
  scale: number;
}) {
  const { kind, intensity } = spec.weather;
  const count = useMemo(() => {
    if (kind === "none") return 0;
    return Math.max(50, Math.floor(intensity * 600));
  }, [kind, intensity]);

  const points = useMemo(() => {
    if (count === 0) return null;
    const arr = new Float32Array(count * 3);
    let h = (count * 9301 + Math.floor(scale * 31)) >>> 0;
    const rng = () => {
      h = (h * 1664525 + 1013904223) >>> 0;
      return h / 0xffffffff;
    };
    for (let i = 0; i < count; i += 1) {
      arr[i * 3 + 0] = (rng() * 2 - 1) * scale * 1.5;
      arr[i * 3 + 1] = rng() * scale * 0.6;
      arr[i * 3 + 2] = (rng() * 2 - 1) * scale * 1.5;
    }
    return arr;
  }, [count, scale]);

  const ref = useRef<THREE.Points>(null);
  const respawnSeed = useRef(((count + 1) * 2654435761) >>> 0);
  const invalidate = useThree((s) => s.invalidate);
  // Static weathers (fog, or no weather) don't animate. Skipping useFrame
  // entirely is what lets the demand-driven render loop quiesce when
  // nothing else is moving.
  const animated = count > 0 && kind !== "fog";
  useFrame((_, delta) => {
    if (!animated || !ref.current || !points) return;
    const positions = ref.current.geometry.attributes.position.array as Float32Array;
    const fallY = kind === "snow" || kind === "ash" || kind === "embers" ? 1.2 : 8;
    for (let i = 0; i < count; i += 1) {
      positions[i * 3 + 1] -= delta * fallY;
      if (positions[i * 3 + 1] < 0) {
        respawnSeed.current = (respawnSeed.current * 1664525 + 1013904223) >>> 0;
        const r1 = (respawnSeed.current / 0xffffffff) * 2 - 1;
        respawnSeed.current = (respawnSeed.current * 1664525 + 1013904223) >>> 0;
        const r2 = (respawnSeed.current / 0xffffffff) * 2 - 1;
        positions[i * 3 + 1] = scale * 0.6;
        positions[i * 3 + 0] = r1 * scale * 1.5;
        positions[i * 3 + 2] = r2 * scale * 1.5;
      }
    }
    ref.current.geometry.attributes.position.needsUpdate = true;
    invalidate(); // weather is continuous animation
  });

  if (count === 0 || !points) return null;

  const color =
    kind === "snow"
      ? "#f8fafc"
      : kind === "rain"
        ? "#7ec0ff"
        : kind === "dust"
          ? "#caa97d"
          : kind === "ash"
            ? "#888888"
            : kind === "embers"
              ? "#ff8a3a"
              : "#cccccc";
  const size = kind === "rain" ? 0.05 : kind === "fog" ? 0.4 : 0.12;

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[points, 3]}
          count={count}
        />
      </bufferGeometry>
      <pointsMaterial
        color={color}
        size={size}
        transparent
        opacity={kind === "fog" ? 0.25 : 0.7}
        sizeAttenuation
      />
    </points>
  );
}

function SkyDome({ sky }: { sky: Sky }) {
  const top = sky.palette[0] ?? "#9bc1ee";
  const mid = sky.palette[1] ?? top;
  const bot = sky.palette[2] ?? mid;
  const blendColor = lerpColor(top, bot, 0.5);
  return (
    <>
      <color attach="background" args={[blendColor]} />
      <mesh position={[0, 0, 0]}>
        <sphereGeometry args={[400, 32, 16]} />
        <meshBasicMaterial color={blendColor} side={1} />
      </mesh>
      <mesh position={[0, 200, 0]}>
        <sphereGeometry args={[200, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshBasicMaterial color={top} side={1} transparent opacity={0.55} />
      </mesh>
    </>
  );
}

function GroundPlane({
  surface,
  scale,
  interior,
  onClick,
}: {
  surface: Surface;
  scale: number;
  interior: boolean;
  onClick?: (info: GroundClickInfo) => void;
}) {
  const color = surface.palette[0] ?? "#7a7a7a";
  const accent = surface.palette[1] ?? color;
  const planeSize = scale * GROUND_OVERSCALE;
  return (
    <group>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
        onClick={(e) => {
          if (!onClick) return;
          e.stopPropagation();
          onClick({ worldX: e.point.x, worldZ: e.point.z });
        }}
      >
        <planeGeometry args={[planeSize, planeSize]} />
        <meshStandardMaterial color={color} roughness={interior ? 0.6 : 0.95} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
        <ringGeometry args={[scale * 0.95, scale * 1.0, 64]} />
        <meshBasicMaterial
          color={accent}
          side={THREE.DoubleSide}
          transparent
          opacity={0.35}
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-2}
          polygonOffsetUnits={-4}
        />
      </mesh>
    </group>
  );
}

function SceneContent({
  spec,
  initialPlayerPosition,
  playerLabel,
  onGroundClick,
  onExitClick,
  onPlayerPositionChange,
  movementRef,
  children,
}: SceneRendererProps) {
  const lighting = useMemo(() => lightingFromSpec(spec), [spec]);
  const interior = isInteriorArchetype(spec.archetype);
  const handleRef = useRef<PlayerMovementHandle | null>(null);
  const playerGroupRef = useRef<THREE.Group | null>(null);
  const initial = initialPlayerPosition ?? [0, 0, 0];

  function handleGroundClick(info: GroundClickInfo) {
    onGroundClick?.(info);
    handleRef.current?.setTarget(info.worldX, info.worldZ);
  }

  function handleHandle(handle: PlayerMovementHandle | null) {
    handleRef.current = handle;
    if (movementRef) {
      movementRef.current = handle;
    }
  }

  return (
    <>
      <CameraRig followRef={playerGroupRef} />

      <SkyDome sky={spec.sky} />

      <ambientLight color={lighting.ambient.color} intensity={lighting.ambient.intensity} />
      {lighting.directional.intensity > 0 ? (
        <directionalLight
          color={lighting.directional.color}
          intensity={lighting.directional.intensity}
          position={lighting.directional.position}
          castShadow
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
        />
      ) : null}
      <hemisphereLight
        args={[lighting.hemisphereSky, lighting.hemisphereGround, lighting.hemisphereIntensity]}
      />

      {/* Only render fog when the weather actually is foggy. The previous
          default fog (near = scale*1.2, far = scale*4) clipped everything in
          small interiors (e.g. the camera sat past `far`), producing a black
          screen. */}
      {spec.weather.kind === "fog" ? (
        <fog attach="fog" args={[spec.sky.palette[0] ?? "#cccccc", 10, spec.scale * 1.5]} />
      ) : null}

      <GroundPlane
        surface={spec.surface}
        scale={spec.scale}
        interior={interior}
        onClick={handleGroundClick}
      />

      <FeatureInstances features={spec.features} scale={spec.scale} surface={spec.surface} />

      {spec.exits.map((exit, i) => (
        <ExitMarker
          key={`exit-${i}`}
          exit={exit}
          scale={spec.scale}
          onClick={onExitClick ? () => onExitClick(exit) : undefined}
        />
      ))}

      <Weather spec={spec} scale={spec.scale} />

      <PlayerController
        groupRef={playerGroupRef}
        spec={spec}
        initialPosition={initial}
        label={playerLabel}
        onPositionChange={onPlayerPositionChange}
        onHandle={handleHandle}
      />

      {children}
    </>
  );
}

export function SceneRenderer(props: SceneRendererProps) {
  return (
    <div className="sceneRoot">
      <Canvas
        // PCFSoftShadowMap is deprecated in three.js (warns every frame).
        // "basic" gives hard-edged but silent and fast shadows.
        shadows="basic"
        // Demand-driven render loop; see Overworld.tsx for the rationale.
        // Movement, camera lerp, and animated weather each call
        // `invalidate()` while they have work to do; idle = silent fan.
        frameloop="demand"
        camera={{
          position: [INTERIOR_CAMERA_OFFSET, INTERIOR_CAMERA_HEIGHT, INTERIOR_CAMERA_OFFSET],
          fov: 45,
          near: 0.1,
          far: 800,
        }}
        gl={{ antialias: true }}
        dpr={[1, 2]}
      >
        <SceneContent {...props} />
      </Canvas>
    </div>
  );
}
