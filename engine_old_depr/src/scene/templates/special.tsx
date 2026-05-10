import type { TemplateProps } from "./types";
import { colorAt } from "./types";

export function Pod({ position, rotation = 0, scale = 1, palette }: TemplateProps) {
  const shell = colorAt(palette, 0);
  const glow = colorAt(palette, 1) ?? "#7fdcff";
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, 1.0 * scale, 0]}>
        <capsuleGeometry args={[0.7 * scale, 1.0 * scale, 6, 12]} />
        <meshStandardMaterial color={shell} metalness={0.5} roughness={0.4} />
      </mesh>
      <mesh position={[0, 1.4 * scale, 0.55 * scale]}>
        <sphereGeometry args={[0.32 * scale, 12, 10]} />
        <meshStandardMaterial color={glow} emissive={glow} emissiveIntensity={1.0} transparent opacity={0.85} />
      </mesh>
    </group>
  );
}

export function Machine({ position, rotation = 0, scale = 1, palette }: TemplateProps) {
  const body = colorAt(palette, 0);
  const trim = colorAt(palette, 1);
  const indicator = colorAt(palette, 2) ?? "#ff7755";
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, 0.7 * scale, 0]}>
        <boxGeometry args={[1.8 * scale, 1.4 * scale, 1.0 * scale]} />
        <meshStandardMaterial color={body} metalness={0.6} roughness={0.45} />
      </mesh>
      <mesh position={[0, 1.6 * scale, 0]}>
        <boxGeometry args={[1.4 * scale, 0.4 * scale, 0.6 * scale]} />
        <meshStandardMaterial color={trim} metalness={0.5} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.5 * scale, 0.51 * scale]}>
        <ringGeometry args={[0.18 * scale, 0.24 * scale, 16]} />
        <meshStandardMaterial color={indicator} emissive={indicator} emissiveIntensity={1.2} side={2} />
      </mesh>
    </group>
  );
}

export function CrystalCluster({ position, rotation = 0, scale = 1, palette }: TemplateProps) {
  const a = colorAt(palette, 0) ?? "#a8d8ff";
  const b = colorAt(palette, 1) ?? "#7c66ff";
  const shards: Array<[number, number, number, number]> = [
    [0, 0, 0, 1],
    [0.5, 0.2, -0.3, 0.7],
    [-0.5, 0, 0.3, 0.8],
    [0.2, 0.4, 0.5, 0.6],
    [-0.4, 0.1, -0.4, 0.9],
  ];
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {shards.map(([dx, , dz, s], i) => (
        <mesh
          key={i}
          position={[dx * scale, (s * scale) / 2, dz * scale]}
          rotation={[(i % 3) * 0.2, i * 0.7, (i % 2) * 0.4]}
        >
          <coneGeometry args={[0.25 * s * scale, 1.4 * s * scale, 5]} />
          <meshStandardMaterial
            color={i % 2 ? a : b}
            emissive={i % 2 ? a : b}
            emissiveIntensity={0.45}
            transparent
            opacity={0.85}
          />
        </mesh>
      ))}
    </group>
  );
}

export function EnergyConduit({ position, rotation = 0, scale = 1, palette }: TemplateProps) {
  const casing = colorAt(palette, 0);
  const energy = colorAt(palette, 1) ?? "#80ffff";
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, 1.4 * scale, 0]}>
        <cylinderGeometry args={[0.18 * scale, 0.18 * scale, 2.8 * scale, 8]} />
        <meshStandardMaterial color={casing} metalness={0.8} roughness={0.3} />
      </mesh>
      {[0.4, 1.0, 1.6, 2.2].map((y, i) => (
        <mesh key={i} position={[0, y * scale, 0]}>
          <torusGeometry args={[0.32 * scale, 0.05 * scale, 6, 16]} />
          <meshStandardMaterial color={energy} emissive={energy} emissiveIntensity={1.4} />
        </mesh>
      ))}
    </group>
  );
}

export function Obelisk({ position, rotation = 0, scale = 1, palette }: TemplateProps) {
  const stone = colorAt(palette, 0);
  const glyph = colorAt(palette, 1) ?? "#ffd58a";
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, 2.4 * scale, 0]}>
        <boxGeometry args={[0.8 * scale, 4.8 * scale, 0.8 * scale]} />
        <meshStandardMaterial color={stone} />
      </mesh>
      <mesh position={[0, 4.95 * scale, 0]}>
        <coneGeometry args={[0.6 * scale, 0.6 * scale, 4]} />
        <meshStandardMaterial color={stone} />
      </mesh>
      {[1.4, 2.4, 3.4].map((y, i) => (
        <mesh key={i} position={[0, y * scale, 0.41 * scale]}>
          <boxGeometry args={[0.4 * scale, 0.25 * scale, 0.02 * scale]} />
          <meshStandardMaterial color={glyph} emissive={glyph} emissiveIntensity={0.3} />
        </mesh>
      ))}
    </group>
  );
}

export function Pyre({ position, rotation = 0, scale = 1, palette }: TemplateProps) {
  const wood = colorAt(palette, 0) ?? "#5a3a2a";
  const flame = colorAt(palette, 1) ?? "#ffaa55";
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, 0.25 * scale, 0]}>
        <cylinderGeometry args={[0.7 * scale, 0.8 * scale, 0.3 * scale, 8]} />
        <meshStandardMaterial color="#3a2a1a" />
      </mesh>
      {[0, Math.PI / 2, Math.PI / 4, -Math.PI / 4].map((rot, i) => (
        <mesh
          key={i}
          position={[0, 0.55 * scale, 0]}
          rotation={[Math.PI / 2, 0, rot]}
        >
          <cylinderGeometry args={[0.06 * scale, 0.06 * scale, 1.2 * scale, 5]} />
          <meshStandardMaterial color={wood} />
        </mesh>
      ))}
      <mesh position={[0, 1.0 * scale, 0]}>
        <coneGeometry args={[0.4 * scale, 0.9 * scale, 8]} />
        <meshStandardMaterial color={flame} emissive={flame} emissiveIntensity={1.6} transparent opacity={0.9} />
      </mesh>
    </group>
  );
}

