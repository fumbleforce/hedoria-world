import { useRef, useState } from "react";
import { useStore } from "../state/store";
import {
  GRID,
  STUDIO_EDGE,
  STUDIO_VB,
  STUDIO_ZONE_HIT,
  ZONE_LIST,
  pointerToZoneCell,
  zoneGridCenter,
  type ZoneId,
} from "../game/studio";

type Props = {
  roomImage: string | null;
  onEnlarge?: (src: string, label: string) => void;
};

/**
 * Square room-map preview with draggable zone hotspots (Settings → Room).
 * Positions persist in `zoneCells` and drive the in-game studio overlay.
 */
export function RoomMapEditor({ roomImage, onEnlarge }: Props) {
  const zoneCells = useStore((s) => s.zoneCells);
  const setZoneCell = useStore((s) => s.setZoneCell);
  const resetZoneCells = useStore((s) => s.resetZoneCells);
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragZone, setDragZone] = useState<ZoneId | null>(null);

  const onPointerDown = (zoneId: ZoneId, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragZone(zoneId);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragZone || !svgRef.current) return;
    const cell = pointerToZoneCell(svgRef.current, e.clientX, e.clientY);
    setZoneCell(dragZone, cell);
  };

  const endDrag = (e: React.PointerEvent) => {
    if (dragZone) {
      try {
        (e.currentTarget as Element).releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
    }
    setDragZone(null);
  };

  return (
    <div className="roomMapEditor">
      {roomImage ? (
        <button
          type="button"
          className="roomMapEditor__imgbtn"
          onClick={() => onEnlarge?.(roomImage, "Studio room")}
          title="Click to enlarge"
        >
          <img src={roomImage} alt="Studio room map" className="roomMapEditor__img" />
        </button>
      ) : (
        <div className="roomMapEditor__placeholder" aria-hidden />
      )}

      <svg
        ref={svgRef}
        viewBox={`0 0 ${STUDIO_VB} ${STUDIO_VB}`}
        className="roomMapEditor__svg"
        role="img"
        aria-label="Zone layout editor"
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {ZONE_LIST.map((z) => {
          const [cx, cy] = zoneGridCenter(zoneCells[z.id]);
          const half = STUDIO_ZONE_HIT / 2;
          return (
            <g
              key={z.id}
              className={`roomMapEditor__zone ${dragZone === z.id ? "is-dragging" : ""}`}
              onPointerDown={(e) => onPointerDown(z.id, e)}
              style={{ cursor: dragZone ? "grabbing" : "grab" }}
            >
              <rect
                x={cx - half}
                y={cy - half}
                width={STUDIO_ZONE_HIT}
                height={STUDIO_ZONE_HIT}
                rx="14"
                fill="rgba(255,93,143,0.14)"
                stroke="rgba(255,93,143,0.75)"
                strokeWidth="2"
                strokeDasharray="6 4"
              />
              <g pointerEvents="none">
                <rect x={cx - 46} y={cy + half - 26} width="92" height="17" rx="8" fill="rgba(12,10,18,0.72)" />
                <text x={cx} y={cy + half - 14} textAnchor="middle" className="studio__label">
                  {z.label}
                </text>
              </g>
            </g>
          );
        })}
        {/* faint grid hints */}
        {Array.from({ length: GRID }, (_, i) => i).map((i) => {
          const [gx] = zoneGridCenter([i, 0]);
          const [, gy] = zoneGridCenter([0, i]);
          return (
            <g key={`g-${i}`} pointerEvents="none" opacity="0.2">
              <line x1={gx} y1={STUDIO_EDGE - 20} x2={gx} y2={STUDIO_VB - STUDIO_EDGE + 20} stroke="#fff" strokeWidth="1" />
              <line x1={STUDIO_EDGE - 20} y1={gy} x2={STUDIO_VB - STUDIO_EDGE + 20} y2={gy} stroke="#fff" strokeWidth="1" />
            </g>
          );
        })}
      </svg>

      <div className="roomMapEditor__bar">
        <span className="hint">Drag zones to match your room art — if a zone doesn't line up with the furniture in the generated image, move it onto the right spot. Used in-game for clicks and character position.</span>
        <button type="button" className="btn btn--ghost btn--mini" onClick={() => resetZoneCells()}>
          Reset positions
        </button>
      </div>
    </div>
  );
}
