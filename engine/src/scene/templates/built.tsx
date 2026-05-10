import type { TemplateProps } from "./types";
import { colorAt } from "./types";

const SQRT_3 = Math.sqrt(3);

export function PillarCluster({ position, rotation = 0, scale = 1, palette }: TemplateProps) {
  const color = colorAt(palette, 0);
  const accent = colorAt(palette, 1);
  const radius = 0.35 * scale;
  const height = 3.2 * scale;
  const layout: Array<[number, number]> = [
    [0, 0],
    [1.4, 0],
    [-1.4, 0],
    [0.7, 1.2],
    [-0.7, 1.2],
  ];
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {layout.map(([dx, dz], i) => (
        <group key={i} position={[dx * scale, 0, dz * scale]}>
          <mesh position={[0, height / 2, 0]} castShadow>
            <cylinderGeometry args={[radius, radius * 1.05, height, 12]} />
            <meshStandardMaterial color={color} />
          </mesh>
          <mesh position={[0, height + 0.18 * scale, 0]} castShadow>
            <boxGeometry args={[radius * 2.4, 0.36 * scale, radius * 2.4]} />
            <meshStandardMaterial color={accent} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

export function Tower({ position, rotation = 0, scale = 1, palette }: TemplateProps) {
  const wall = colorAt(palette, 0);
  const roof = colorAt(palette, 1);
  const trim = colorAt(palette, 2);
  const radius = 1.4 * scale;
  const height = 7 * scale;
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, height / 2, 0]} castShadow>
        <cylinderGeometry args={[radius, radius * 1.1, height, 16]} />
        <meshStandardMaterial color={wall} />
      </mesh>
      <mesh position={[0, height + 0.2 * scale, 0]} castShadow>
        <torusGeometry args={[radius * 1.05, 0.18 * scale, 8, 24]} />
        <meshStandardMaterial color={trim} />
      </mesh>
      <mesh position={[0, height + 1.4 * scale, 0]} castShadow>
        <coneGeometry args={[radius * 1.05, 2 * scale, 16]} />
        <meshStandardMaterial color={roof} />
      </mesh>
    </group>
  );
}

export function Spire({ position, rotation = 0, scale = 1, palette }: TemplateProps) {
  const base = colorAt(palette, 0);
  const tip = colorAt(palette, 1);
  const height = 9 * scale;
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, height / 2, 0]} castShadow>
        <coneGeometry args={[0.9 * scale, height, 8]} />
        <meshStandardMaterial color={base} />
      </mesh>
      <mesh position={[0, height + 0.4 * scale, 0]} castShadow>
        <octahedronGeometry args={[0.55 * scale, 0]} />
        <meshStandardMaterial color={tip} emissive={tip} emissiveIntensity={0.25} />
      </mesh>
    </group>
  );
}

export function DomeHall({ position, rotation = 0, scale = 1, palette }: TemplateProps) {
  const wall = colorAt(palette, 0);
  const dome = colorAt(palette, 1);
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, 1.2 * scale, 0]} castShadow>
        <cylinderGeometry args={[3 * scale, 3.1 * scale, 2.4 * scale, 16]} />
        <meshStandardMaterial color={wall} />
      </mesh>
      <mesh position={[0, 2.4 * scale, 0]} castShadow>
        <sphereGeometry args={[3 * scale, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={dome} />
      </mesh>
    </group>
  );
}

export function House({ position, rotation = 0, scale = 1, palette }: TemplateProps) {
  const wall = colorAt(palette, 0);
  const roof = colorAt(palette, 1);
  const door = colorAt(palette, 2);
  const w = 2.4 * scale;
  const h = 2.2 * scale;
  const d = 2.2 * scale;
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, h / 2, 0]} castShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color={wall} />
      </mesh>
      <mesh position={[0, h + 0.4 * scale, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
        <coneGeometry args={[w * 0.8, 0.9 * scale, 4]} />
        <meshStandardMaterial color={roof} />
      </mesh>
      <mesh position={[0, 0.5 * scale, d / 2 + 0.005]}>
        <boxGeometry args={[0.5 * scale, 1 * scale, 0.05 * scale]} />
        <meshStandardMaterial color={door} />
      </mesh>
    </group>
  );
}

export function Stall({ position, rotation = 0, scale = 1, palette }: TemplateProps) {
  const post = colorAt(palette, 0);
  const cloth = colorAt(palette, 1);
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {[
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ].map(([dx, dz], i) => (
        <mesh key={i} position={[dx * 0.9 * scale, 0.9 * scale, dz * 0.9 * scale]}>
          <cylinderGeometry args={[0.06 * scale, 0.06 * scale, 1.8 * scale, 6]} />
          <meshStandardMaterial color={post} />
        </mesh>
      ))}
      <mesh position={[0, 1.85 * scale, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[2 * scale, 2 * scale]} />
        <meshStandardMaterial color={cloth} side={2} />
      </mesh>
      <mesh position={[0, 0.7 * scale, 0]}>
        <boxGeometry args={[1.7 * scale, 0.1 * scale, 1.7 * scale]} />
        <meshStandardMaterial color={post} />
      </mesh>
    </group>
  );
}

export function Bridge({ position, rotation = 0, scale = 1, palette }: TemplateProps) {
  const deck = colorAt(palette, 0);
  const rail = colorAt(palette, 1);
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, 0.4 * scale, 0]}>
        <boxGeometry args={[5 * scale, 0.25 * scale, 1.6 * scale]} />
        <meshStandardMaterial color={deck} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[0, 0.9 * scale, side * 0.75 * scale]}>
          <boxGeometry args={[5 * scale, 0.6 * scale, 0.1 * scale]} />
          <meshStandardMaterial color={rail} />
        </mesh>
      ))}
    </group>
  );
}

export function GateArch({ position, rotation = 0, scale = 1, palette }: TemplateProps) {
  const stone = colorAt(palette, 0);
  const trim = colorAt(palette, 1);
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * 1.4 * scale, 1.6 * scale, 0]}>
          <boxGeometry args={[0.6 * scale, 3.2 * scale, 0.6 * scale]} />
          <meshStandardMaterial color={stone} />
        </mesh>
      ))}
      <mesh position={[0, 3.4 * scale, 0]}>
        <boxGeometry args={[3.5 * scale, 0.6 * scale, 0.7 * scale]} />
        <meshStandardMaterial color={trim} />
      </mesh>
    </group>
  );
}

export function WallSection({ position, rotation = 0, scale = 1, palette }: TemplateProps) {
  const stone = colorAt(palette, 0);
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, 1.4 * scale, 0]} castShadow>
        <boxGeometry args={[5 * scale, 2.8 * scale, 0.6 * scale]} />
        <meshStandardMaterial color={stone} />
      </mesh>
      {[-2, -1, 0, 1, 2].map((slot) => (
        <mesh key={slot} position={[slot * 1.0 * scale, 2.95 * scale, 0]}>
          <boxGeometry args={[0.6 * scale, 0.3 * scale, 0.6 * scale]} />
          <meshStandardMaterial color={stone} />
        </mesh>
      ))}
    </group>
  );
}

export function Stair({ position, rotation = 0, scale = 1, palette }: TemplateProps) {
  const stone = colorAt(palette, 0);
  const steps = 5;
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {Array.from({ length: steps }).map((_, i) => (
        <mesh key={i} position={[0, 0.18 * scale * (i + 0.5), -i * 0.4 * scale]}>
          <boxGeometry args={[2.2 * scale, 0.18 * scale, 0.4 * scale]} />
          <meshStandardMaterial color={stone} />
        </mesh>
      ))}
    </group>
  );
}

export function Platform({ position, rotation = 0, scale = 1, palette }: TemplateProps) {
  const top = colorAt(palette, 0);
  const base = colorAt(palette, 1);
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, 0.3 * scale, 0]}>
        <cylinderGeometry args={[2 * scale, 2.2 * scale, 0.6 * scale, 12]} />
        <meshStandardMaterial color={base} />
      </mesh>
      <mesh position={[0, 0.65 * scale, 0]}>
        <cylinderGeometry args={[1.85 * scale, 1.85 * scale, 0.1 * scale, 12]} />
        <meshStandardMaterial color={top} />
      </mesh>
    </group>
  );
}

export function Statue({ position, rotation = 0, scale = 1, palette }: TemplateProps) {
  const stone = colorAt(palette, 0);
  const trim = colorAt(palette, 1);
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, 0.3 * scale, 0]}>
        <boxGeometry args={[1.2 * scale, 0.6 * scale, 1.2 * scale]} />
        <meshStandardMaterial color={trim} />
      </mesh>
      <mesh position={[0, 1.4 * scale, 0]}>
        <cylinderGeometry args={[0.3 * scale, 0.4 * scale, 1.6 * scale, 8]} />
        <meshStandardMaterial color={stone} />
      </mesh>
      <mesh position={[0, 2.55 * scale, 0]}>
        <sphereGeometry args={[0.32 * scale, 8, 6]} />
        <meshStandardMaterial color={stone} />
      </mesh>
    </group>
  );
}

export function Fountain({ position, rotation = 0, scale = 1, palette }: TemplateProps) {
  const stone = colorAt(palette, 0);
  const water = colorAt(palette, 1) ?? "#3b6dba";
  // Geometry note: the basin top must NOT be coplanar with the water surface,
  // otherwise the two faces fight for the same depth (the flickering you saw).
  // Basin: y=0.15..0.65, water surface: y=0.50, so the water sits ~0.15 below
  // the rim — looks like a real fountain bowl and resolves z-fighting.
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, 0.4 * scale, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[1.6 * scale, 1.7 * scale, 0.5 * scale, 18]} />
        <meshStandardMaterial color={stone} />
      </mesh>
      <mesh position={[0, 0.5 * scale, 0]}>
        <cylinderGeometry args={[1.4 * scale, 1.4 * scale, 0.04 * scale, 18]} />
        <meshStandardMaterial
          color={water}
          transparent
          opacity={0.8}
          depthWrite={false}
        />
      </mesh>
      <mesh position={[0, 1.25 * scale, 0]} castShadow>
        <cylinderGeometry args={[0.18 * scale, 0.22 * scale, 1.2 * scale, 8]} />
        <meshStandardMaterial color={stone} />
      </mesh>
      <mesh position={[0, 1.9 * scale, 0]} castShadow>
        <sphereGeometry args={[0.32 * scale, 10, 8]} />
        <meshStandardMaterial color={water} emissive={water} emissiveIntensity={0.25} />
      </mesh>
    </group>
  );
}

export function Lamp({ position, rotation = 0, scale = 1, palette }: TemplateProps) {
  const post = colorAt(palette, 0);
  const glow = colorAt(palette, 1) ?? "#ffd58a";
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, 1.3 * scale, 0]}>
        <cylinderGeometry args={[0.05 * scale, 0.07 * scale, 2.6 * scale, 6]} />
        <meshStandardMaterial color={post} />
      </mesh>
      <mesh position={[0, 2.7 * scale, 0]}>
        <sphereGeometry args={[0.25 * scale, 10, 8]} />
        <meshStandardMaterial color={glow} emissive={glow} emissiveIntensity={1.4} />
      </mesh>
    </group>
  );
}

export function DoorPortal({ position, rotation = 0, scale = 1, palette, label }: TemplateProps) {
  const frame = colorAt(palette, 0);
  const door = colorAt(palette, 1);
  return (
    <group position={position} rotation={[0, rotation, 0]} userData={{ template: "door-portal", label }}>
      <mesh position={[0, 1.1 * scale, 0]}>
        <boxGeometry args={[1.4 * scale, 2.2 * scale, 0.3 * scale]} />
        <meshStandardMaterial color={frame} />
      </mesh>
      <mesh position={[0, 1.05 * scale, 0.16 * scale]}>
        <boxGeometry args={[1.0 * scale, 1.95 * scale, 0.05 * scale]} />
        <meshStandardMaterial color={door} />
      </mesh>
      <mesh position={[0.32 * scale, 1.05 * scale, 0.2 * scale]}>
        <sphereGeometry args={[0.06 * scale, 8, 6]} />
        <meshStandardMaterial color="#d9c98a" emissive="#7a6a3a" emissiveIntensity={0.4} />
      </mesh>
    </group>
  );
}

// Registry consumed by templates/index.ts (no shared constants exported here)
// to keep this file component-only for React Fast Refresh.

void SQRT_3;
