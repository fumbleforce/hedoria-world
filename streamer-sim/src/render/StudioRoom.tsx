import { useEffect, useState } from "react";
import { useStore } from "../state/store";
import { useStoredImage } from "../persist/useStoredImage";
import { loadPortrait } from "../persist/imageStore";
import type { GameController } from "../game/controller";
import { hasCharacterLook } from "../game/characterVisual";
import { cameraDisplayLabel } from "../game/cameras";
import {
  ZONE_LIST,
  ZONES,
  STUDIO_VB,
  STUDIO_ZONE_HIT,
  zoneGridCenter,
  zoneStandCell,
  type ZoneId,
} from "../game/studio";

/**
 * The studio. If the player has generated a room image (LLM), it's rendered as
 * the background and the zones become labeled hotspots over it. Otherwise a
 * hand-authored flat SVG room is drawn. Either way the character glides between
 * zones on click.
 */
export function StudioRoom({ controller }: { controller: GameController }) {
  const zone = useStore((s) => s.zone);
  const zoneCells = useStore((s) => s.zoneCells);
  const isLive = useStore((s) => s.session.isLive);
  const activity = useStore((s) => s.activity);
  const visitor = useStore((s) => s.visitor);
  const guestId = useStore((s) => s.visitor?.charId ?? null);
  const guestName = useStore((s) =>
    s.visitor ? (s.roster[s.visitor.charId]?.displayName || s.roster[s.visitor.charId]?.handle || "guest") : "",
  );
  const guestHasPortrait = useStore((s) =>
    s.visitor ? !!s.roster[s.visitor.charId]?.hasPortrait : false,
  );
  const [guestPortrait, setGuestPortrait] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setGuestPortrait(null);
    if (guestId && guestHasPortrait) {
      void loadPortrait(guestId).then((u) => { if (alive) setGuestPortrait(u); });
    }
    return () => { alive = false; };
  }, [guestId, guestHasPortrait]);
  const roomImage = useStore((s) => s.roomImage);
  const generating = useStore((s) => s.generatingRoom);
  const presenceId = useStore((s) => s.presenceImages[zone]);
  const portraitId = useStore((s) => s.character.portraitId);
  const presenceUrl = useStoredImage(presenceId);
  const portraitUrl = useStoredImage(portraitId);
  const avatarUrl = presenceUrl ?? portraitUrl;
  const imageBusy = useStore((s) => s.imageBusy);
  const cameras = useStore((s) => s.cameras);
  const activeCameraId = useStore((s) => s.activeCameraId);
  const hasCharacter = useStore((s) => hasCharacterLook(s.character));
  const canGenImages = controller.canGenerateImages;
  const [px, py] = zoneGridCenter(zoneStandCell(zone, zoneCells));

  return (
    <div className="studio">
      <svg viewBox={`0 0 ${STUDIO_VB} ${STUDIO_VB}`} className="studio__svg" role="img" aria-label="studio apartment">
        <defs>
          <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3a3350" />
            <stop offset="100%" stopColor="#2e2942" />
          </linearGradient>
        </defs>

        {roomImage ? (
          <image
            href={roomImage}
            x="0"
            y="0"
            width={STUDIO_VB}
            height={STUDIO_VB}
            preserveAspectRatio="xMidYMid meet"
          />
        ) : (
          <DefaultRoom zoneCells={zoneCells} live={isLive} />
        )}

        {ZONE_LIST.map((z) => {
          const [cx, cy] = zoneGridCenter(zoneStandCell(z.id, zoneCells));
          const active = zone === z.id;
          const half = STUDIO_ZONE_HIT / 2;
          return (
            <g key={z.id} className="studio__zone" onClick={() => controller.openZoneMenu(z.id)} style={{ cursor: "pointer" }}>
              <rect
                x={cx - half}
                y={cy - half}
                width={STUDIO_ZONE_HIT}
                height={STUDIO_ZONE_HIT}
                rx="14"
                fill={active ? "rgba(255,93,143,0.12)" : "transparent"}
                stroke={active ? "rgba(255,93,143,0.6)" : "rgba(255,255,255,0.07)"}
                strokeWidth="2"
              />
              <g>
                <rect x={cx - 46} y={cy + half - 26} width="92" height="17" rx="8" fill="rgba(12,10,18,0.66)" />
                <text x={cx} y={cy + half - 14} textAnchor="middle" className="studio__label">{z.label}</text>
              </g>
            </g>
          );
        })}

        {visitor && (() => {
          const [gx, gy] = zoneGridCenter(zoneStandCell("couch", zoneCells));
          return (
            <g style={{ transform: `translate(${gx + 52}px, ${gy + 10}px)` }}>
              <ellipse cx="0" cy="40" rx="22" ry="6" fill="rgba(0,0,0,0.4)" />
              {guestPortrait ? (
                <>
                  <defs>
                    <clipPath id="guestClip">
                      <circle cx="0" cy="2" r="19" />
                    </clipPath>
                  </defs>
                  <image
                    href={guestPortrait}
                    x={-26}
                    y={-24}
                    width={52}
                    height={52}
                    preserveAspectRatio="xMidYMid slice"
                    clipPath="url(#guestClip)"
                  />
                  <circle cx="0" cy="2" r="19" fill="none" stroke="#fff" strokeWidth="2.5" />
                </>
              ) : (
                <>
                  <circle cx="0" cy="2" r="17" fill="var(--accent-2)" stroke="#fff" strokeWidth="2.5" />
                  <text x="0" y="9" textAnchor="middle" fontSize="18">🧑</text>
                </>
              )}
              <rect x={-48} y={24} width="96" height="17" rx="8" fill="rgba(12,10,18,0.72)" />
              <text x="0" y="36" textAnchor="middle" className="studio__label">🏠 {guestName}</text>
            </g>
          );
        })()}

        <g style={{ transform: `translate(${px}px, ${py}px)`, transition: "transform 0.35s cubic-bezier(.4,1.3,.5,1)" }}>
          <ellipse cx="0" cy="42" rx="26" ry="7" fill="rgba(0,0,0,0.4)" />
          {avatarUrl ? (
            <>
              <defs>
                <clipPath id="presClip">
                  <circle cx="0" cy="6" r="34" />
                </clipPath>
              </defs>
              <image
                href={avatarUrl}
                x={-46}
                y={-40}
                width={92}
                height={92}
                preserveAspectRatio="xMidYMid slice"
                clipPath="url(#presClip)"
              />
              <circle cx="0" cy="6" r="34" fill="none" stroke={isLive ? "var(--accent)" : "var(--offline)"} strokeWidth="3" />
            </>
          ) : (
            <>
              <circle cx="0" cy="2" r="17" fill={isLive ? "var(--accent)" : "var(--offline)"} stroke="#fff" strokeWidth="2.5" />
              <text x="0" y="9" textAnchor="middle" fontSize="20">{isLive ? "🔴" : "🙂"}</text>
            </>
          )}
        </g>
      </svg>

      <div className="studio__bar">
        <div className={`studio__hint ${generating ? "is-loading" : ""}`}>
          {generating ? "🖼 generating room art…" : activity ? `🎬 ${activity.label} · click a spot to act` : "Click a spot to go there and act"}
        </div>
        {isLive && cameras.filter((c) => c.zone || c.portable).length > 0 && (
          <div className="studio__cams">
            {cameras.filter((c) => c.zone || c.portable).map((c) => (
              <button
                key={c.id}
                type="button"
                className={`btn btn--mini ${activeCameraId === c.id ? "btn--primary" : ""}`}
                onClick={() => controller.switchCamera(c.id)}
                title={c.portable ? "Portable cam" : `Placed at ${ZONES[c.zone!]?.label ?? c.zone}`}
              >
                📷 {cameraDisplayLabel(c)}
              </button>
            ))}
          </div>
        )}
        {canGenImages && hasCharacter && (
          <>
          <button
            className="btn btn--mini"
            disabled={!!imageBusy}
            onClick={() => void controller.generatePresence(zone, !!presenceUrl)}
            title="Generate (and cache) your character at this spot"
          >
            {presenceUrl ? "📸 Redo here" : "📸 Visualize here"}
          </button>
          {isLive && (
            <button
              className="btn btn--mini"
              disabled={!!imageBusy}
              onClick={() => void controller.generateCamFootage(zone, true)}
              title="Regenerate the live stream feed (center panel) from this camera"
            >
              📹 Refresh feed
            </button>
          )}
          </>
        )}
      </div>
    </div>
  );
}

function DefaultRoom({ zoneCells, live }: { zoneCells: Record<ZoneId, [number, number]>; live: boolean }) {
  const at = (zoneId: ZoneId): [number, number] => zoneGridCenter(zoneStandCell(zoneId, zoneCells));

  return (
    <>
      <rect x="0" y="0" width={STUDIO_VB} height={STUDIO_VB} rx="14" fill="url(#floor)" stroke="#4a4366" strokeWidth="3" />
      <ellipse cx={at("couch")[0]} cy={at("couch")[1] + 16} rx="64" ry="40" fill="#5b4a7a" opacity="0.45" />
      <Bed at={at} />
      <Desk at={at} live={live} />
      <Couch at={at} />
      <Kitchenette at={at} />
      <Bathroom at={at} />
      <Door at={at} />
    </>
  );
}

type AtFn = (zoneId: ZoneId) => [number, number];

function Bed({ at }: { at: AtFn }) {
  const [x, y] = at("bed");
  return (
    <g>
      <rect x={x - 34} y={y - 24} width="68" height="48" rx="8" fill="#6a5b8c" />
      <rect x={x - 30} y={y - 20} width="60" height="26" rx="6" fill="#8a7ab0" />
      <rect x={x - 26} y={y - 16} width="22" height="16" rx="5" fill="#e9e2f5" />
    </g>
  );
}

function Desk({ at, live }: { at: AtFn; live: boolean }) {
  const [x, y] = at("desk");
  return (
    <g>
      <rect x={x - 36} y={y + 2} width="72" height="26" rx="6" fill="#4a3f63" />
      <rect x={x - 30} y={y - 22} width="26" height="19" rx="3" fill="#10131c" stroke={live ? "var(--accent)" : "#3a4a6a"} strokeWidth="2" />
      <rect x={x + 4} y={y - 22} width="26" height="19" rx="3" fill="#10131c" stroke={live ? "var(--accent)" : "#3a4a6a"} strokeWidth="2" />
      <rect x={x - 36} y={y + 28} width="72" height="3" fill={live ? "var(--accent)" : "var(--accent-2)"} opacity="0.8" />
    </g>
  );
}

function Couch({ at }: { at: AtFn }) {
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

function Kitchenette({ at }: { at: AtFn }) {
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

function Bathroom({ at }: { at: AtFn }) {
  const [x, y] = at("bathroom");
  return (
    <g>
      <rect x={x - 32} y={y - 22} width="64" height="46" rx="8" fill="#3c3656" stroke="#544c70" strokeWidth="2" />
      <rect x={x - 22} y={y - 13} width="20" height="28" rx="6" fill="#9fb8d8" opacity="0.8" />
      <circle cx={x + 15} cy={y + 6} r="7" fill="#cdd6e6" />
    </g>
  );
}

function Door({ at }: { at: AtFn }) {
  const [x, y] = at("door");
  return (
    <g>
      <rect x={x - 15} y={y - 24} width="30" height="48" rx="4" fill="#6b5536" stroke="#86693f" strokeWidth="2" />
      <circle cx={x + 8} cy={y} r="2.6" fill="#e8c873" />
    </g>
  );
}
