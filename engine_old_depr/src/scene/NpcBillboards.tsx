import { Html } from "@react-three/drei";
import { useMemo, useState } from "react";
import * as THREE from "three";
import type { ComposedFeature, ComposedSceneSpec, SceneScope, TemplateId } from "./sceneSpec";
import type { PackNpc } from "../schema/packSchema";

type Props = {
  spec: ComposedSceneSpec;
  npcs: PackNpc[];
  onTalkToNpc: (npc: PackNpc) => void;
  /**
   * World-space origin offset applied to every NPC position. Used by Overworld
   * to place NPCs inside their location patch.
   */
  origin?: [number, number, number];
  /**
   * Optional override for the spread radius (defaults to spec.scale * 0.45).
   */
  radius?: number;
  /**
   * If true, prefer area-scope feature anchors over location/region features
   * for placement. Used when rendering an interior sub-scene.
   */
  preferAreaAnchors?: boolean;
};

const PORTRAIT_PALETTE = [
  "#f59e0b",
  "#10b981",
  "#ef4444",
  "#8b5cf6",
  "#3b82f6",
  "#ec4899",
  "#14b8a6",
  "#f97316",
];

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function npcAccent(npc: PackNpc): string {
  return PORTRAIT_PALETTE[hashStr(npc.name) % PORTRAIT_PALETTE.length];
}

function shadeColor(hex: string, delta: number): string {
  const m = /^#([0-9a-f]{6})$/iu.exec(hex);
  if (!m) return hex;
  const num = parseInt(m[1], 16);
  const r = Math.max(0, Math.min(255, ((num >> 16) & 0xff) + delta));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0xff) + delta));
  const b = Math.max(0, Math.min(255, (num & 0xff) + delta));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
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
      <mesh position={[0, -1.0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.5, 0.7, 24]} />
        <meshBasicMaterial color={npcAccent(npc)} transparent opacity={0.65} />
      </mesh>
      {hovered ? (
        <Html distanceFactor={20} position={[0, 1.6, 0]} center zIndexRange={[10, 0]}>
          <div className="floatingLabel">{npc.name}</div>
        </Html>
      ) : null}
    </group>
  );
}

const ANCHOR_TEMPLATES: ReadonlySet<TemplateId> = new Set<TemplateId>([
  "stall",
  "fountain",
  "lamp",
  "statue",
  "platform",
  "machine",
  "pyre",
  "house",
  "bridge",
  "gate-arch",
]);

type Anchor = {
  x: number;
  z: number;
  source: SceneScope;
};

function buildAnchors(spec: ComposedSceneSpec, preferAreaAnchors: boolean, radius: number): Anchor[] {
  const anchors: Anchor[] = [];
  const filterScope = (feature: ComposedFeature): boolean => {
    if (!ANCHOR_TEMPLATES.has(feature.template)) return false;
    if (preferAreaAnchors) return feature.source === "area" || feature.source === "location";
    return feature.source === "location" || feature.source === "area";
  };
  for (const feature of spec.features) {
    if (!filterScope(feature)) continue;
    anchors.push({
      x: feature.x * radius,
      z: feature.z * radius,
      source: feature.source,
    });
  }
  return anchors;
}

/**
 * Phase 5 placement: seat NPCs at SceneSpec feature anchors when available,
 * falling back to a deterministic circular spread. Each anchor is offset by a
 * small deterministic jitter so multiple NPCs sharing an anchor don't overlap.
 */
export function NpcBillboards({
  spec,
  npcs,
  onTalkToNpc,
  origin = [0, 0, 0],
  radius,
  preferAreaAnchors = false,
}: Props) {
  const radiusValue = radius ?? spec.scale * 0.45;
  const sorted = useMemo(
    () => [...npcs].sort((a, b) => hashStr(a.name) - hashStr(b.name)),
    [npcs],
  );
  const anchors = useMemo(
    () => buildAnchors(spec, preferAreaAnchors, radiusValue),
    [spec, preferAreaAnchors, radiusValue],
  );
  if (sorted.length === 0) return null;
  return (
    <>
      {sorted.map((npc, i) => {
        let x: number;
        let z: number;
        if (anchors.length > 0) {
          const anchor = anchors[hashStr(npc.name) % anchors.length];
          const jitterAngle = ((hashStr(`${npc.name}::angle`) % 360) / 360) * Math.PI * 2;
          const jitterRadius = 1.2 + (hashStr(`${npc.name}::radius`) % 90) / 100;
          x = anchor.x + Math.cos(jitterAngle) * jitterRadius;
          z = anchor.z + Math.sin(jitterAngle) * jitterRadius;
        } else {
          const angle = (i / Math.max(1, sorted.length)) * Math.PI * 2;
          x = Math.cos(angle) * radiusValue;
          z = Math.sin(angle) * radiusValue;
        }
        return (
          <NpcSprite
            key={npc.name}
            npc={npc}
            position={[origin[0] + x, origin[1] + 1.1, origin[2] + z]}
            onClick={() => onTalkToNpc(npc)}
          />
        );
      })}
    </>
  );
}
