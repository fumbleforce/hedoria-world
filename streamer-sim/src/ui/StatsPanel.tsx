import { useMemo } from "react";
import { useStore } from "../state/store";
import { BALANCE } from "../game/balance";
import { masteryLevel } from "../game/mastery";
import { NICHES } from "../game/niches";
import { OUTFITS } from "../game/outfits";
import { SEGMENTS, type SegmentId } from "../game/segments";
import { multipliersFor } from "../game/shop";

interface StatRow {
  label: string;
  value: string;
  warn?: boolean;
}

/** Passive modifiers and setup — live readout below the activity log. */
export function StatsPanel() {
  const niche = useStore((s) => s.settings.niche);
  const outfit = useStore((s) => s.settings.outfit);
  const ownedUpgrades = useStore((s) => s.ownedUpgrades);
  const mastery = useStore((s) => s.mastery);
  const contentNovelty = useStore((s) => s.contentNovelty);

  const rows = useMemo(() => {
    const mult = multipliersFor(ownedUpgrades);
    const out: StatRow[] = [];

    out.push({ label: "Niche", value: NICHES[niche]?.label ?? niche });
    out.push({ label: "Outfit", value: OUTFITS[outfit]?.label ?? outfit });

    const freshness = contentNovelty[niche] ?? 1;
    out.push({
      label: "Freshness",
      value: `${Math.round(freshness * 100)}%`,
      warn: freshness < 0.6,
    });

    if (mult.productionQuality) {
      const appeal = mult.productionQuality * BALANCE.gear.productionQualityToAppeal;
      out.push({
        label: "Production",
        value: `${mult.productionQuality} (+${appeal} appeal)`,
      });
    }

    if (mult.viewer !== 1) out.push({ label: "Viewers", value: `×${mult.viewer.toFixed(2)}` });
    if (mult.hype !== 1) out.push({ label: "Hype gain", value: `×${mult.hype.toFixed(2)}` });
    if (mult.income !== 1) out.push({ label: "Income", value: `×${mult.income.toFixed(2)}` });
    if (mult.moodPerDay) out.push({ label: "Mood", value: `+${mult.moodPerDay}/day` });
    out.push({ label: "Rent", value: `$${mult.rentPerDay}/day` });

    for (const [seg, v] of Object.entries(mult.segmentAppeal) as [SegmentId, number][]) {
      if (v) out.push({ label: SEGMENTS[seg].label, value: `+${v} appeal` });
    }

    for (const d of BALANCE.mastery.domains) {
      const lvl = masteryLevel(mastery[d] ?? 0);
      const label = d === "showmanship" ? "Showmanship" : "Composure";
      out.push({ label, value: lvl > 0 ? `Lv ${lvl}` : "—" });
    }

    return out;
  }, [niche, outfit, ownedUpgrades, mastery, contentNovelty]);

  return (
    <section className="statspanel">
      <div className="statspanel__head">
        <span>Stats</span>
      </div>
      <ul className="statspanel__list">
        {rows.map((r) => (
          <li key={r.label} className="statspanel__row">
            <span className="statspanel__label">{r.label}</span>
            <span className={`statspanel__value${r.warn ? " statspanel__value--warn" : ""}`}>{r.value}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
