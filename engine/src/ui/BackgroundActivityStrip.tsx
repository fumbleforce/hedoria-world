import { useMemo } from "react";
import { useStore } from "../state/store";
import { LoadingPill } from "./LoadingPill";

/**
 * Fixed HUD strip listing every long-running call the engine has in flight:
 * narrator round-trips, region/location grid LLM fills, other text-LLM
 * tasks, and image-model requests (mosaic, per-tile, portraits). This stays
 * outside the map canvas so it does not depend on tile mount state.
 */
export function BackgroundActivityStrip() {
  const generating = useStore((s) => s.generating);
  const pendingNarrations = useStore((s) => s.pendingNarrations);
  const backgroundActivities = useStore((s) => s.backgroundActivities);

  const lines = useMemo(() => {
    const out: string[] = [];
    if (pendingNarrations > 0) {
      out.push(
        pendingNarrations > 1
          ? `Narrator · responding (${pendingNarrations})`
          : "Narrator · responding",
      );
    }
    if (generating.regionGridFor) {
      out.push(`Region map · ${generating.regionGridFor}`);
    }
    if (generating.locationGridFor) {
      out.push(`Location map · ${generating.locationGridFor}`);
    }
    for (const label of Object.values(backgroundActivities)) {
      out.push(label);
    }
    return out;
  }, [generating, pendingNarrations, backgroundActivities]);

  if (lines.length === 0) return null;

  return (
    <div
      className="activityStrip"
      role="status"
      aria-live="polite"
      aria-label="Background tasks in progress"
    >
      <span className="activityStrip__title">Working</span>
      <div className="activityStrip__pills">
        {lines.map((label, i) => (
          <LoadingPill key={`${i}:${label}`} label={label} inline />
        ))}
      </div>
    </div>
  );
}
