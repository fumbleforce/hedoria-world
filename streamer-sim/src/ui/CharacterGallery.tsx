import { useStore } from "../state/store";
import type { GameController } from "../game/controller";
import { avatarFor, relationshipLevel } from "../game/characters";
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

  const chars = Object.values(roster)
    .filter((c) => c.messageCount > 0 || c.known || c.online)
    .sort((a, b) => {
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
            <button key={c.id} className={`card ${c.online ? "card--online" : ""}`} onClick={() => controller.openCharacter(c.id)}>
              <span className="card__avatar">{avatarFor(c)}</span>
              <span className="card__body">
                <span className="card__handle">
                  {c.handle}
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

function satColor(s: number): string {
  if (s >= 65) return "#8ce99a";
  if (s >= 45) return "#ffd43b";
  return "#ff9e6b";
}
