import type { TemplateProps } from "./types";
import { colorAt } from "./types";

function jitter(seed: number, count: number): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  let h = seed;
  for (let i = 0; i < count; i += 1) {
    h = (h * 9301 + 49297) % 233280;
    const r1 = h / 233280;
    h = (h * 9301 + 49297) % 233280;
    const r2 = h / 233280;
    h = (h * 9301 + 49297) % 233280;
    const r3 = h / 233280;
    out.push([r1 * 2 - 1, r2 * 2 - 1, r3]);
  }
  return out;
}

export function TreeCluster({ position, rotation = 0, scale = 1, palette }: TemplateProps) {
  const trunk = colorAt(palette, 0);
  const leaves = colorAt(palette, 1);
  const trees = jitter(7, 6);
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {trees.map(([dx, dz, h], i) => {
        const treeHeight = (1.6 + h * 1.4) * scale;
        return (
          <group key={i} position={[dx * 1.4 * scale, 0, dz * 1.4 * scale]}>
            <mesh position={[0, treeHeight / 2, 0]}>
              <cylinderGeometry args={[0.12 * scale, 0.16 * scale, treeHeight, 6]} />
              <meshStandardMaterial color={trunk} />
            </mesh>
            <mesh position={[0, treeHeight + 0.4 * scale, 0]}>
              <coneGeometry args={[0.7 * scale, 1.4 * scale, 8]} />
              <meshStandardMaterial color={leaves} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

export function RockCluster({ position, rotation = 0, scale = 1, palette }: TemplateProps) {
  const stone = colorAt(palette, 0);
  const accent = colorAt(palette, 1);
  const rocks = jitter(13, 5);
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {rocks.map(([dx, dz, s], i) => (
        <mesh
          key={i}
          position={[dx * 1.2 * scale, 0.3 * scale * (0.6 + s), dz * 1.2 * scale]}
          rotation={[s * 1.5, dx * 2, dz * 2]}
        >
          <dodecahedronGeometry args={[(0.4 + s * 0.6) * scale, 0]} />
          <meshStandardMaterial color={i % 2 === 0 ? stone : accent} flatShading />
        </mesh>
      ))}
    </group>
  );
}

export function Cliff({ position, rotation = 0, scale = 1, palette }: TemplateProps) {
  const stone = colorAt(palette, 0);
  const accent = colorAt(palette, 1);
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, 2 * scale, 0]} castShadow>
        <boxGeometry args={[6 * scale, 4 * scale, 2 * scale]} />
        <meshStandardMaterial color={stone} flatShading />
      </mesh>
      <mesh position={[1.6 * scale, 3.2 * scale, 0.3 * scale]}>
        <boxGeometry args={[2 * scale, 1.4 * scale, 1.4 * scale]} />
        <meshStandardMaterial color={accent} flatShading />
      </mesh>
    </group>
  );
}

export function MountainSilhouette({ position, rotation = 0, scale = 1, palette }: TemplateProps) {
  const a = colorAt(palette, 0);
  const b = colorAt(palette, 1);
  const c = colorAt(palette, 2);
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[-2 * scale, 4 * scale, 0]}>
        <coneGeometry args={[3 * scale, 8 * scale, 6]} />
        <meshStandardMaterial color={a} flatShading />
      </mesh>
      <mesh position={[1.5 * scale, 5 * scale, -1.5 * scale]}>
        <coneGeometry args={[3.5 * scale, 10 * scale, 6]} />
        <meshStandardMaterial color={b} flatShading />
      </mesh>
      <mesh position={[3.5 * scale, 3.5 * scale, 0.5 * scale]}>
        <coneGeometry args={[2.4 * scale, 7 * scale, 6]} />
        <meshStandardMaterial color={c} flatShading />
      </mesh>
    </group>
  );
}

export function Crater({ position, rotation = 0, scale = 1, palette }: TemplateProps) {
  const rim = colorAt(palette, 0);
  const inside = colorAt(palette, 1);
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, 0.3 * scale, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.6 * scale, 2.4 * scale, 24]} />
        <meshStandardMaterial color={rim} side={2} />
      </mesh>
      <mesh position={[0, -0.05 * scale, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1.6 * scale, 24]} />
        <meshStandardMaterial color={inside} />
      </mesh>
    </group>
  );
}

export function Pond({ position, rotation = 0, scale = 1, palette }: TemplateProps) {
  const water = colorAt(palette, 0) ?? "#3a6fb3";
  const bank = colorAt(palette, 1) ?? "#3a4a2a";
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, 0.04 * scale, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[2 * scale, 24]} />
        <meshStandardMaterial color={water} transparent opacity={0.9} />
      </mesh>
      <mesh position={[0, 0.02 * scale, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[2 * scale, 2.4 * scale, 24]} />
        <meshStandardMaterial color={bank} side={2} />
      </mesh>
    </group>
  );
}

