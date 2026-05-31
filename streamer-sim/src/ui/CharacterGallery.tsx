import { useEffect, useState } from "react";
import { useStore } from "../state/store";
import type { GameController } from "../game/controller";
import { avatarFor, relationshipLevel, type CharacterSheet } from "../game/characters";
import { loadPortrait } from "../persist/imageStore";
import { SEGMENTS, SEGMENT_IDS } from "../game/segments";

/**
 * The right rail: a compact audience-segment strip on top, then a gallery of
 * named characters that fills in as people chat. Online first, then known
 * offline regulars. Click anyone to open their sheet + DM.
 */
export function CharacterGallery({ controller }: { controller: GameController }) {
  const roster = useStore((s) => s.roster);
  const audience = useStore((s) => s.audience);
  const isLive = useStore((s) => s.session.isLive);
  const unreadDms = useStore((s) => s.unreadDms);

  const chars = Object.values(roster)
    .filter((c) => c.messageCount > 0 || c.known || c.online || unreadDms[c.id])
    .sort((a, b) => {
      // Unread DMs float to the top so a new message is impossible to miss.
      const ua = unreadDms[a.id] ? 1 : 0;
      const ub = unreadDms[b.id] ? 1 : 0;
      if (ua !== ub) return ub - ua;
      if (a.online !== b.online) return a.online ? -1 : 1;
      return b.affinity - a.affinity;
    });

  const presentSegs = SEGMENT_IDS.filter((id) => audience[id].population >= 0.5);

  return (
    <aside className="rail">
      <div className="rail__seg">
        <div className="rail__title">Audience</div>
        {!isLive ? (
          <p className="rail__empty">Offline.</p>
        ) : presentSegs.length === 0 ? (
          <p className="rail__empty">Empty room…</p>
        ) : (
          presentSegs.map((id) => {
            const seg = audience[id];
            return (
              <div key={id} className="segrow" title={SEGMENTS[id].blurb}>
                <span className="segrow__name">{SEGMENTS[id].label}</span>
                <span className="segrow__pop">×{Math.round(seg.population)}</span>
                <span className="segrow__bar">
                  <span
                    className="segrow__fill"
                    style={{ width: `${seg.satisfaction}%`, background: id === "stalkers" ? "#ff6b6b" : satColor(seg.satisfaction) }}
                  />
                </span>
              </div>
            );
          })
        )}
      </div>

      <div className="rail__title rail__title--sticky">
        Regulars <span className="rail__count">{chars.length}</span>
      </div>
      <div className="gallery">
        {chars.length === 0 ? (
          <p className="rail__empty">As people chat, they'll show up here. Get to know them.</p>
        ) : (
          chars.map((c) => (
            <button key={c.id} className={`card ${c.online ? "card--online" : ""} ${unreadDms[c.id] ? "card--unread" : ""}`} onClick={() => controller.openCharacter(c.id)}>
              <CardAvatar c={c} />
              <span className="card__body">
                <span className="card__handle">
                  {c.displayName || c.handle}
                  {c.displayName && <span className="card__handle-sub">@{c.handle}</span>}
                  {unreadDms[c.id] > 0 && (
                    <span className="card__unread" title={`${unreadDms[c.id]} new DM${unreadDms[c.id] > 1 ? "s" : ""}`}>
                      📨 {unreadDms[c.id]}
                    </span>
                  )}
                  {c.attendanceStreak >= 3 && <span className="card__streak" title={`${c.attendanceStreak} streams running`}>🔥{c.attendanceStreak}</span>}
                  {c.online && <span className="card__dot" title="online" />}
                </span>
                <span className="card__rel">{relationshipLevel(c.affinity)}{c.threat >= 2 ? " · ⚠ stalker" : ""}</span>
              </span>
            </button>
          ))
        )}
      </div>
    </aside>
  );
}

/** Avatar glyph, swapped for a cached portrait thumbnail when one exists. */
function CardAvatar({ c }: { c: CharacterSheet }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (c.hasPortrait) void loadPortrait(c.id).then((u) => { if (alive) setUrl(u); });
    else setUrl(null);
    return () => { alive = false; };
  }, [c.id, c.hasPortrait]);
  return (
    <span className="card__avatar">
      {url ? <img className="card__portrait" src={url} alt={c.handle} /> : avatarFor(c)}
    </span>
  );
}

function satColor(s: number): string {
  if (s >= 65) return "#8ce99a";
  if (s >= 45) return "#ffd43b";
  return "#ff9e6b";
}
