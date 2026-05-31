import { useState } from "react";
import { useStore } from "../state/store";
import type { GameController } from "../game/controller";
import {
  ACTIVITIES,
  ACTIVITY_CATEGORY_LABEL,
  type Activity,
  type ActivityCategory,
} from "../game/activities";
import { SEGMENTS } from "../game/segments";
import { isNoLimits, tierIntensity } from "../game/content";

const CATEGORY_ORDER: ActivityCategory[] = ["game", "performance", "creative", "chill", "intimate"];

function activityLocked(a: Activity, owned: string[]): boolean {
  return a.cost != null && a.cost > 0 && !owned.includes(a.id);
}

function activityBlocked(a: Activity, tier: ReturnType<typeof useStore.getState>["settings"]["contentTier"]): string | null {
  if (a.noLimitsOnly && !isNoLimits(tier)) return "No Limits tier required";
  if (a.minIntensity != null && tierIntensity(tier) < a.minIntensity) return "Higher content tier required";
  return null;
}

/** Modal to pick a stream activity (games, performances, or custom). */
export function ActivityPicker({ controller }: { controller: GameController }) {
  const open = useStore((s) => s.activityPickerOpen);
  const owned = useStore((s) => s.ownedActivities);
  const tier = useStore((s) => s.settings.contentTier);
  const [custom, setCustom] = useState("");
  if (!open) return null;
  const close = () => useStore.getState().setActivityPickerOpen(false);

  const startCustom = () => {
    const t = custom.trim();
    if (!t) return;
    controller.startActivity({ custom: t });
    setCustom("");
  };

  return (
    <div className="modal" onClick={close}>
      <div className="modal__card modal__card--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2>🎬 Start an activity</h2>
          <button className="modal__close" onClick={close}>✕</button>
        </div>

        {CATEGORY_ORDER.map((cat) => {
          const items = ACTIVITIES.filter((a) => a.category === cat);
          if (!items.length) return null;
          return (
            <div key={cat} className="shop__group">
              <h3>{ACTIVITY_CATEGORY_LABEL[cat]}</h3>
              <div className="games">
                {items.map((a) => {
                  const locked = activityLocked(a, owned);
                  const blocked = activityBlocked(a, tier);
                  const disabled = !!locked || !!blocked;
                  return (
                    <button
                      key={a.id}
                      className={`gamecard ${disabled ? "gamecard--locked" : ""}`}
                      disabled={disabled}
                      onClick={() => controller.startActivity(a.id)}
                      title={blocked ?? (locked ? "Buy in shop" : a.blurb)}
                    >
                      <span className="gamecard__emoji">{a.emoji}</span>
                      <span className="gamecard__name">{a.name}</span>
                      <span className="gamecard__blurb">{a.blurb}</span>
                      <span className="gamecard__pleases">
                        loves it: {a.pleases.map((p) => SEGMENTS[p].label).join(", ") || "—"}
                      </span>
                      {locked && <span className="gamecard__lock">🔒 Buy in shop · ${a.cost}</span>}
                      {blocked && !locked && <span className="gamecard__lock">{blocked}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        <div className="activitypick__custom">
          <h3>Custom activity</h3>
          <p className="muted">Anything else — read aloud, stretch, whatever you type.</p>
          <form
            className="activitypick__form"
            onSubmit={(e) => {
              e.preventDefault();
              startCustom();
            }}
          >
            <input
              className="activitypick__input"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="e.g. read fan mail aloud, do yoga on cam…"
            />
            <button className="btn btn--primary" type="submit" disabled={!custom.trim()}>
              Start
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
