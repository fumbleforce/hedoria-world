import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { IndexedWorld } from "../../world/indexer";
import type { PackLocation, PackNpc } from "../../schema/packSchema";
import { biomeForLocation, fallbackPropForArea } from "../fallbacks/assetFallbacks";

type Props = {
  world: IndexedWorld;
  locationId: string;
  currentAreaId: string | null;
  onMoveToArea: (areaId: string) => void;
  onTalkToNpc: (npc: PackNpc) => void;
};

type AreaPos = {
  id: string;
  name: string;
  description: string;
  x: number;
  z: number;
  size: number;
  color: string;
  shape: "tower" | "house" | "spire" | "stall" | "stone";
};

const AREA_SPACING = 9;
const PAD_SIZE = 3.2;

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function layoutAreas(location: PackLocation): AreaPos[] {
  const entries = Object.entries(location.areas ?? {});
  if (entries.length === 0) {
    return [
      {
        id: "open-ground",
        name: "Open Ground",
        description: location.basicInfo,
        x: 0,
        z: 0,
        size: PAD_SIZE,
        color: "#a8a29e",
        shape: "stone",
      },
    ];
  }
  const positions: AreaPos[] = [];
  const layoutRadius = AREA_SPACING * Math.max(1.5, Math.sqrt(entries.length));
  if (entries.length === 1) {
    const [id, area] = entries[0];
    const prop = fallbackPropForArea(`${id} ${area.description}`);
    positions.push({
      id,
      name: id,
      description: area.description,
      x: 0,
      z: 0,
      size: PAD_SIZE,
      color: prop.color,
      shape: prop.shape,
    });
    return positions;
  }
  entries.forEach(([id, area], index) => {
    const seed = hashStr(`${location.name}/${id}`);
    const baseAngle = (index / entries.length) * Math.PI * 2;
    const jitter = (((seed % 1000) / 1000) - 0.5) * 0.3;
    const angle = baseAngle + jitter;
    const r = layoutRadius * (0.85 + (((seed >> 10) % 1000) / 1000) * 0.25);
    const prop = fallbackPropForArea(`${id} ${area.description}`);
    positions.push({
      id,
      name: id,
      description: area.description,
      x: Math.cos(angle) * r,
      z: Math.sin(angle) * r,
      size: PAD_SIZE,
      color: prop.color,
      shape: prop.shape,
    });
  });
  return positions;
}

function buildEdges(location: PackLocation, positions: AreaPos[]): Array<[AreaPos, AreaPos]> {
  const byId = new Map(positions.map((p) => [p.id, p]));
  const edges: Array<[AreaPos, AreaPos]> = [];
  const seen = new Set<string>();
  for (const [areaId, area] of Object.entries(location.areas ?? {})) {
    const from = byId.get(areaId);
    if (!from) continue;
    for (const targetId of area.paths ?? []) {
      const to = byId.get(targetId);
      if (!to) continue;
      const key = [areaId, targetId].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push([from, to]);
    }
  }
  return edges;
}

function makePortraitTexture(name: string, accent: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 384;
  const ctx = canvas.getContext("2d")!;
  const accentDark = shadeColor(accent, -50);
  const accentLight = shadeColor(accent, 30);
  const bg = ctx.createLinearGradient(0, 0, 0, 384);
  bg.addColorStop(0, accentLight);
  bg.addColorStop(1, accentDark);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 256, 384);

  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.beginPath();
  ctx.moveTo(20, 380);
  ctx.bezierCurveTo(60, 250, 196, 250, 236, 380);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.beginPath();
  ctx.arc(128, 130, 62, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.beginPath();
  ctx.arc(108, 122, 6, 0, Math.PI * 2);
  ctx.arc(148, 122, 6, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(128, 145, 14, 0, Math.PI);
  ctx.stroke();

  ctx.fillStyle = accent;
  ctx.fillRect(70, 198, 116, 18);

  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, 350, 256, 34);
  ctx.fillStyle = "#f9fafb";
  ctx.font = "bold 18px Inter, Arial";
  ctx.textAlign = "center";
  const initials = name
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
  ctx.fillText(`${initials} · ${name.slice(0, 18)}`, 128, 374);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function npcAccent(npc: PackNpc): string {
  const palette = ["#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#3b82f6", "#ec4899", "#14b8a6"];
  return palette[hashStr(npc.name) % palette.length];
}

function jitterForNpcs(npcs: PackNpc[]): Map<string, { dx: number; dz: number }> {
  const out = new Map<string, { dx: number; dz: number }>();
  const grouped = new Map<string, PackNpc[]>();
  for (const npc of npcs) {
    const key = `${npc.currentLocation}/${npc.currentArea}`;
    const arr = grouped.get(key) ?? [];
    arr.push(npc);
    grouped.set(key, arr);
  }
  for (const [, arr] of grouped) {
    const sorted = [...arr].sort((a, b) => hashStr(a.name) - hashStr(b.name));
    const count = sorted.length;
    sorted.forEach((npc, i) => {
      if (count === 1) {
        out.set(npc.name, { dx: 0, dz: 1.2 });
        return;
      }
      const radius = 1.8;
      const angle = (i / count) * Math.PI * 2;
      out.set(npc.name, { dx: Math.cos(angle) * radius, dz: Math.sin(angle) * radius });
    });
  }
  return out;
}

function CameraRig({ target }: { target: [number, number, number] }) {
  const { camera } = useThree();
  const desired = useRef(new THREE.Vector3());
  const lookAt = useRef(new THREE.Vector3());
  useEffect(() => {
    desired.current.set(target[0] + 35, 50, target[2] + 35);
    lookAt.current.set(target[0], 0, target[2]);
    camera.position.copy(desired.current);
    camera.lookAt(lookAt.current);
    camera.updateProjectionMatrix();
  }, [camera, target]);
  useFrame(() => {
    desired.current.set(target[0] + 35, 50, target[2] + 35);
    lookAt.current.set(target[0], 0, target[2]);
    camera.position.lerp(desired.current, 0.08);
    camera.lookAt(lookAt.current);
  });
  return null;
}

function PlayerSprite({ position }: { position: [number, number, number] }) {
  const texture = useMemo(() => makePortraitTexture("You", "#facc15"), []);
  const ref = useRef<THREE.Sprite>(null);
  const targetPos = useRef(new THREE.Vector3(...position));
  useEffect(() => {
    targetPos.current.set(...position);
  }, [position]);
  useFrame(() => {
    if (!ref.current) return;
    ref.current.position.lerp(targetPos.current, 0.12);
  });
  return (
    <group>
      <sprite ref={ref} position={position} scale={[1.4, 2.1, 1]}>
        <spriteMaterial map={texture} transparent />
      </sprite>
    </group>
  );
}

function NpcSprite({
  npc,
  position,
  onClick,
}: {
  npc: PackNpc;
  position: [number, number, number];
  onClick: () => void;
}) {
  const texture = useMemo(() => makePortraitTexture(npc.name, npcAccent(npc)), [npc]);
  const [hovered, setHovered] = useState(false);
  return (
    <group position={position}>
      <sprite
        scale={[1.3, 1.95, 1]}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={(e) => {
          e.stopPropagation();
          setHovered(false);
          document.body.style.cursor = "default";
        }}
      >
        <spriteMaterial map={texture} transparent />
      </sprite>
      <mesh position={[0, -1.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.5, 0.7, 24]} />
        <meshBasicMaterial color={npcAccent(npc)} transparent opacity={0.65} />
      </mesh>
      {hovered ? (
        <Html
          distanceFactor={20}
          position={[0, 1.6, 0]}
          center
          zIndexRange={[10, 0]}
        >
          <div className="floatingLabel">{npc.name}</div>
        </Html>
      ) : null}
    </group>
  );
}

function AreaRoom({
  area,
  isCurrent,
  onClick,
}: {
  area: AreaPos;
  isCurrent: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <group position={[area.x, 0, area.z]}>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.02, 0]}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={(e) => {
          e.stopPropagation();
          setHovered(false);
          document.body.style.cursor = "default";
        }}
      >
        <circleGeometry args={[area.size, 36]} />
        <meshStandardMaterial
          color={isCurrent ? "#fde68a" : hovered ? "#e2e8f0" : "#cbd5e1"}
          transparent
          opacity={isCurrent ? 0.92 : 0.7}
          roughness={0.85}
        />
      </mesh>
      <mesh position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[area.size - 0.08, area.size, 36]} />
        <meshBasicMaterial color={isCurrent ? "#f59e0b" : "#475569"} transparent opacity={0.9} />
      </mesh>
      <AreaProp shape={area.shape} color={area.color} />

      <Html
        distanceFactor={22}
        position={[0, 2.2, 0]}
        center
        zIndexRange={[10, 0]}
      >
        <div className={isCurrent ? "areaLabel current" : "areaLabel"}>{area.name}</div>
      </Html>
    </group>
  );
}

function AreaProp({
  shape,
  color,
}: {
  shape: "tower" | "house" | "spire" | "stall" | "stone";
  color: string;
}) {
  const dark = shadeColor(color, -30);
  const light = shadeColor(color, 20);
  switch (shape) {
    case "tower":
      return (
        <group>
          <mesh position={[0, 0.9, 0]} castShadow>
            <cylinderGeometry args={[0.5, 0.55, 1.8, 12]} />
            <meshStandardMaterial color={color} roughness={0.7} />
          </mesh>
          <mesh position={[0, 2.1, 0]} castShadow>
            <coneGeometry args={[0.65, 0.7, 12]} />
            <meshStandardMaterial color={dark} roughness={0.7} />
          </mesh>
          <mesh position={[0, 0.05, 0]} castShadow>
            <cylinderGeometry args={[0.65, 0.7, 0.1, 12]} />
            <meshStandardMaterial color={light} roughness={0.8} />
          </mesh>
        </group>
      );
    case "house":
      return (
        <group>
          <mesh position={[0, 0.45, 0]} castShadow>
            <boxGeometry args={[1.4, 0.9, 1.1]} />
            <meshStandardMaterial color={color} roughness={0.85} />
          </mesh>
          <mesh position={[0, 1.05, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
            <coneGeometry args={[1.0, 0.6, 4]} />
            <meshStandardMaterial color={dark} roughness={0.8} />
          </mesh>
          <mesh position={[0, 0.4, 0.56]}>
            <planeGeometry args={[0.3, 0.5]} />
            <meshStandardMaterial color="#3a2a1a" />
          </mesh>
        </group>
      );
    case "spire":
      return (
        <group>
          <mesh position={[0, 0.4, 0]} castShadow>
            <boxGeometry args={[1.5, 0.8, 1.5]} />
            <meshStandardMaterial color={color} roughness={0.6} />
          </mesh>
          <mesh position={[0, 1.0, 0]} castShadow>
            <boxGeometry args={[0.9, 0.6, 0.9]} />
            <meshStandardMaterial color={light} roughness={0.6} />
          </mesh>
          <mesh position={[0, 1.95, 0]} castShadow>
            <coneGeometry args={[0.55, 1.2, 8]} />
            <meshStandardMaterial color={dark} roughness={0.5} />
          </mesh>
        </group>
      );
    case "stall":
      return (
        <group>
          <mesh position={[0, 0.35, 0]} castShadow>
            <boxGeometry args={[1.4, 0.6, 0.9]} />
            <meshStandardMaterial color={color} roughness={0.85} />
          </mesh>
          <mesh position={[0, 0.85, 0]} castShadow>
            <boxGeometry args={[1.6, 0.1, 1.1]} />
            <meshStandardMaterial color={dark} roughness={0.85} />
          </mesh>
          <mesh position={[-0.6, 0.55, -0.4]} castShadow>
            <cylinderGeometry args={[0.05, 0.05, 0.5, 6]} />
            <meshStandardMaterial color={dark} />
          </mesh>
          <mesh position={[0.6, 0.55, -0.4]} castShadow>
            <cylinderGeometry args={[0.05, 0.05, 0.5, 6]} />
            <meshStandardMaterial color={dark} />
          </mesh>
        </group>
      );
    case "stone":
    default:
      return (
        <group>
          <mesh position={[-0.4, 0.3, -0.2]} castShadow>
            <boxGeometry args={[0.6, 0.6, 0.6]} />
            <meshStandardMaterial color={color} roughness={0.95} />
          </mesh>
          <mesh position={[0.5, 0.4, 0.3]} castShadow>
            <boxGeometry args={[0.7, 0.8, 0.5]} />
            <meshStandardMaterial color={light} roughness={0.95} />
          </mesh>
          <mesh position={[0.0, 0.18, -0.5]} castShadow>
            <cylinderGeometry args={[0.35, 0.35, 0.36, 8]} />
            <meshStandardMaterial color={dark} roughness={0.95} />
          </mesh>
        </group>
      );
  }
}

function shadeColor(hex: string, delta: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const num = parseInt(m[1], 16);
  const r = Math.max(0, Math.min(255, ((num >> 16) & 0xff) + delta));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0xff) + delta));
  const b = Math.max(0, Math.min(255, (num & 0xff) + delta));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

function PathStrip({ from, to }: { from: AreaPos; to: AreaPos }) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const len = Math.sqrt(dx * dx + dz * dz);
  const angle = Math.atan2(dz, dx);
  const midX = (from.x + to.x) / 2;
  const midZ = (from.z + to.z) / 2;
  return (
    <mesh rotation={[-Math.PI / 2, 0, -angle]} position={[midX, 0.01, midZ]}>
      <planeGeometry args={[len, 1.4]} />
      <meshStandardMaterial color="#a8a29e" transparent opacity={0.7} roughness={0.9} />
    </mesh>
  );
}

function Decorations({ count, biomeColor }: { count: number; biomeColor: string }) {
  const decorations = useMemo(() => {
    const items: Array<{ x: number; z: number; size: number; color: string }> = [];
    let seed = 1234;
    const rng = () => {
      seed = Math.imul(seed ^ (seed >>> 15), 2246822507);
      seed = Math.imul(seed ^ (seed >>> 13), 3266489909);
      seed ^= seed >>> 16;
      return ((seed >>> 0) % 1000) / 1000;
    };
    for (let i = 0; i < count; i++) {
      const angle = rng() * Math.PI * 2;
      const dist = 25 + rng() * 35;
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;
      const size = 0.6 + rng() * 1.2;
      items.push({ x, z, size, color: shadeColor(biomeColor, -30 - rng() * 40) });
    }
    return items;
  }, [count, biomeColor]);

  return (
    <>
      {decorations.map((d, i) => (
        <mesh key={i} position={[d.x, d.size / 2, d.z]}>
          <coneGeometry args={[d.size * 0.6, d.size, 6]} />
          <meshStandardMaterial color={d.color} roughness={0.95} />
        </mesh>
      ))}
    </>
  );
}

function SceneContent({ world, locationId, currentAreaId, onMoveToArea, onTalkToNpc }: Props) {
  const location = world.locations[locationId];
  const areaPositions = useMemo(() => (location ? layoutAreas(location) : []), [location]);
  const edges = useMemo(
    () => (location ? buildEdges(location, areaPositions) : []),
    [location, areaPositions],
  );
  const locationNpcs = useMemo(
    () => (locationId ? world.npcsByLocation.get(locationId) ?? [] : []),
    [world, locationId],
  );
  const npcJitter = useMemo(() => jitterForNpcs(locationNpcs), [locationNpcs]);

  const areaPosById = useMemo(() => new Map(areaPositions.map((a) => [a.id, a])), [areaPositions]);
  const effectiveAreaId =
    currentAreaId && areaPosById.has(currentAreaId)
      ? currentAreaId
      : areaPositions[0]?.id ?? null;
  const currentArea = effectiveAreaId ? areaPosById.get(effectiveAreaId) : undefined;

  if (!location || !currentArea) {
    return null;
  }

  const biome = biomeForLocation(location);
  const playerPos: [number, number, number] = [currentArea.x, 1.0, currentArea.z];
  const skyColor = shadeColor(biome.groundColor, 50);

  return (
    <>
      <CameraRig target={[currentArea.x, 0, currentArea.z]} />
      <color attach="background" args={[skyColor]} />
      <fog attach="fog" args={[skyColor, 80, 180]} />

      <ambientLight intensity={0.6} />
      <directionalLight
        position={[40, 60, 30]}
        intensity={1.1}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <hemisphereLight args={[skyColor, "#1e293b", 0.5]} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[400, 400]} />
        <meshStandardMaterial color={biome.groundColor} roughness={1} />
      </mesh>

      <Decorations count={26} biomeColor={biome.groundColor} />

      {edges.map(([from, to]) => (
        <PathStrip key={`${from.id}->${to.id}`} from={from} to={to} />
      ))}

      {areaPositions.map((area) => (
        <AreaRoom
          key={area.id}
          area={area}
          isCurrent={area.id === effectiveAreaId}
          onClick={() => onMoveToArea(area.id)}
        />
      ))}

      {locationNpcs.map((npc) => {
        const areaPos = npc.currentArea ? areaPosById.get(npc.currentArea) : undefined;
        const anchor = areaPos ?? currentArea;
        const j = npcJitter.get(npc.name) ?? { dx: 0, dz: 0 };
        const npcPos: [number, number, number] = [anchor.x + j.dx, 1.1, anchor.z + j.dz];
        return (
          <NpcSprite
            key={npc.name}
            npc={npc}
            position={npcPos}
            onClick={() => onTalkToNpc(npc)}
          />
        );
      })}

      <PlayerSprite position={playerPos} />
    </>
  );
}

export function LocationScene(props: Props) {
  return (
    <div className="sceneRoot">
      <Canvas
        shadows
        camera={{ position: [35, 50, 35], fov: 24, near: 0.1, far: 500 }}
        gl={{ antialias: true }}
        dpr={[1, 2]}
      >
        <SceneContent {...props} />
      </Canvas>
    </div>
  );
}
