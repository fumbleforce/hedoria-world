import { useStore } from "../state/store";
import type { GameController } from "../game/controller";
import { NICHES, nichesForTier, type NicheId } from "../game/niches";

/** Stream-type picker — set at the desk before go-live; Spicy requires Risqué tier+. */
export function StreamNicheSelect({
  controller,
  disabled,
  compact,
}: {
  controller: GameController;
  disabled?: boolean;
  compact?: boolean;
}) {
  const draft = useStore((s) => s.streamNicheDraft);
  const tier = useStore((s) => s.settings.contentTier);
  const ids = nichesForTier(tier);
  const value = ids.includes(draft) ? draft : "variety";

  return (
    <label className="nichepick" title={NICHES[value]?.blurb ?? "Stream type for this session"}>
      {!compact && <span className="nichepick__icon">🗓</span>}
      <select
        className="nichepick__select"
        value={value}
        disabled={disabled}
        onChange={(e) => controller.setStreamNicheDraft(e.target.value as NicheId)}
      >
        {ids.map((id) => (
          <option key={id} value={id}>
            {NICHES[id].label}
          </option>
        ))}
      </select>
    </label>
  );
}
