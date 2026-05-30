import { useStore } from "../state/store";
import type { GameController } from "../game/controller";
import { ZONE_LIST, ZONES, GRID, type ZoneId } from "../game/studio";

/**
 * The studio. If the player has generated a room image (LLM), it's rendered as
 * the background and the zones become labeled hotspots over it. Otherwise a
 * hand-authored flat SVG room is drawn. Either way the character glides between
 * zones on click.
 */
const VB = 500;
const cellPx = VB / GRID;
const center = (cell: [number, number]): [number, number] => [
  cell[0] * cellPx + cellPx / 2,
  cell[1] * cellPx + cellPx / 2,
];

export function StudioRoom({ controller }: { controller: GameController }) {
  const zone = useStore((s) => s.zone);
  const isLive = useStore((s) => s.session.isLive);
  const playing = useStore((s) => s.playing);
  const roomImage = useStore((s) => s.roomImage);
  const generating = useStore((s) => s.generatingRoom);
  const [px, py] = center(ZONES[zone].cell);

  return (
    <div className="studio">
      <svg viewBox={`0 0 ${VB} ${VB}`} className="studio__svg" role="img" aria-label="studio apartment">
        <defs>
          <radialGradient id="glow" cx="50%" cy="35%" r="75%">
            <stop offset="0%" stopColor="#2a2440" />
            <stop offset="100%" stopColor="#1a1626" />
          </radialGradient>
          <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3a3350" />
            <stop offset="100%" stopColor="#2e2942" />
          </linearGradient>
          <clipPath id="roomClip">
            <rect x="14" y="14" width={VB - 28} height={VB - 28} rx="14" />
          </clipPath>
        </defs>

        {roomImage ? (
          <>
            <rect x="0" y="0" width={VB} height={VB} fill="#1a1626" />
            <image
              href={roomImage}
              x="14"
              y="14"
              width={VB - 28}
              height={VB - 28}
              preserveAspectRatio="xMidYMid slice"
              clipPath="url(#roomClip)"
            />
            <rect x="14" y="14" width={VB - 28} height={VB - 28} rx="14" fill="none" stroke="#4a4366" strokeWidth="3" />
          </>
        ) : (
          <DefaultRoom live={isLive} />
        )}

        {/* clickable zone hotspots + labels (over image or SVG) */}
        {ZONE_LIST.map((z) => {
          const [cx, cy] = center(z.cell);
          const active = zone === z.id;
          return (
            <g key={z.id} className="studio__zone" onClick={() => controller.openZoneMenu(z.id)} style={{ cursor: "pointer" }}>
              <rect
                x={cx - cellPx / 2 + 6}
                y={cy - cellPx / 2 + 6}
                width={cellPx - 12}
                height={cellPx - 12}
                rx="10"
                fill={active ? "rgba(255,93,143,0.12)" : "transparent"}
                stroke={active ? "rgba(255,93,143,0.6)" : "rgba(255,255,255,0.07)"}
                strokeWidth="2"
              />
              <g>
                <rect x={cx - 46} y={cy + cellPx / 2 - 26} width="92" height="17" rx="8" fill="rgba(12,10,18,0.66)" />
                <text x={cx} y={cy + cellPx / 2 - 14} textAnchor="middle" className="studio__label">{z.label}</text>
              </g>
            </g>
          );
        })}

        {/* the streamer */}
        <g style={{ transform: `translate(${px}px, ${py}px)`, transition: "transform 0.35s cubic-bezier(.4,1.3,.5,1)" }}>
          <ellipse cx="0" cy="26" rx="16" ry="6" fill="rgba(0,0,0,0.4)" />
          <circle cx="0" cy="2" r="17" fill={isLive ? "#ff5d8f" : "#7cd3ff"} stroke="#fff" strokeWidth="2.5" />
          <text x="0" y="9" textAnchor="middle" fontSize="20">{isLive ? "🔴" : "🙂"}</text>
        </g>
      </svg>

      <div className="studio__hint">
        {generating ? "🖼 generating room art…" : playing ? "🎮 playing · click a spot to act" : "Click a spot to go there and act"}
      </div>
    </div>
  );
}

// --- default flat-SVG room (furniture centered in each zone cell) -----------

function DefaultRoom({ live }: { live: boolean }) {
  return (
    <>
      <rect x="0" y="0" width={VB} height={VB} fill="url(#glow)" />
      <rect x="14" y="14" width={VB - 28} height={VB - 28} rx="14" fill="url(#floor)" stroke="#4a4366" strokeWidth="3" />
      {/* rug under the couch */}
      <ellipse cx={center(ZONES.couch.art)[0]} cy={center(ZONES.couch.art)[1] + 16} rx="64" ry="40" fill="#5b4a7a" opacity="0.45" />
      <Bed />
      <Desk live={live} />
      <Couch />
      <Kitchenette />
      <Bathroom />
      <Door />
    </>
  );
}

function at(zoneId: ZoneId): [number, number] {
  return center(ZONES[zoneId].art);
}

function Bed() {
  const [x, y] = at("bed");
  return (
    <g>
      <rect x={x - 34} y={y - 24} width="68" height="48" rx="8" fill="#6a5b8c" />
      <rect x={x - 30} y={y - 20} width="60" height="26" rx="6" fill="#8a7ab0" />
      <rect x={x - 26} y={y - 16} width="22" height="16" rx="5" fill="#e9e2f5" />
    </g>
  );
}

function Desk({ live }: { live: boolean }) {
  const [x, y] = at("desk");
  return (
    <g>
      <rect x={x - 36} y={y + 2} width="72" height="26" rx="6" fill="#4a3f63" />
      <rect x={x - 30} y={y - 22} width="26" height="19" rx="3" fill="#10131c" stroke={live ? "#ff5d8f" : "#3a4a6a"} strokeWidth="2" />
      <rect x={x + 4} y={y - 22} width="26" height="19" rx="3" fill="#10131c" stroke={live ? "#ff5d8f" : "#3a4a6a"} strokeWidth="2" />
      <rect x={x - 36} y={y + 28} width="72" height="3" fill={live ? "#ff5d8f" : "#b079ff"} opacity="0.8" />
    </g>
  );
}

function Couch() {
  const [x, y] = at("couch");
  return (
    <g>
      <rect x={x - 40} y={y - 16} width="80" height="32" rx="12" fill="#5a4d77" />
      <rect x={x - 40} y={y - 26} width="80" height="15" rx="8" fill="#6a5b8c" />
      <rect x={x - 28} y={y - 9} width="24" height="20" rx="6" fill="#7d6da3" />
      <rect x={x + 4} y={y - 9} width="24" height="20" rx="6" fill="#7d6da3" />
    </g>
  );
}

function Kitchenette() {
  const [x, y] = at("kitchenette");
  return (
    <g>
      <rect x={x - 34} y={y - 14} width="68" height="30" rx="6" fill="#4f4566" />
      <rect x={x - 28} y={y - 8} width="16" height="16" rx="3" fill="#2a2438" />
      <circle cx={x + 14} cy={y} r="8" fill="#2a2438" />
      <circle cx={x + 14} cy={y} r="4" fill="#ff8c42" opacity="0.85" />
    </g>
  );
}

function Bathroom() {
  const [x, y] = at("bathroom");
  return (
    <g>
      <rect x={x - 32} y={y - 22} width="64" height="46" rx="8" fill="#3c3656" stroke="#544c70" strokeWidth="2" />
      <rect x={x - 22} y={y - 13} width="20" height="28" rx="6" fill="#9fb8d8" opacity="0.8" />
      <circle cx={x + 15} cy={y + 6} r="7" fill="#cdd6e6" />
    </g>
  );
}

function Door() {
  const [x, y] = at("door");
  return (
    <g>
      <rect x={x - 15} y={y - 24} width="30" height="48" rx="4" fill="#6b5536" stroke="#86693f" strokeWidth="2" />
      <circle cx={x + 8} cy={y} r="2.6" fill="#e8c873" />
    </g>
  );
}
