import { useEffect, useMemo } from "react";
import { useStore } from "../state/store";
import type { FeedbackBubble } from "../game/types";

const LIFETIME_MS = 1700;

/**
 * Single global janitor that expires floating bubbles after their lifetime.
 * Mount once near the root (the HUD is always present). Reads fresh state inside
 * the interval so it doesn't churn on every feedback change.
 */
export function useFeedbackJanitor(): void {
  const expire = useStore((s) => s.expireFeedback);
  useEffect(() => {
    const t = setInterval(() => {
      const { feedback } = useStore.getState();
      if (!feedback.length) return;
      const now = Date.now();
      const dead = feedback.filter((b) => now - b.ts > LIFETIME_MS).map((b) => b.id);
      if (dead.length) expire(dead);
    }, 400);
    return () => clearInterval(t);
  }, [expire]);
}

function formatDelta(b: FeedbackBubble): string {
  if (b.text) return b.text;
  if (b.delta == null) return "";
  const sign = b.delta >= 0 ? "+" : "−";
  const mag = Math.abs(b.delta);
  if (b.key === "cash") return `${sign}$${mag >= 1 ? Math.round(mag) : mag.toFixed(1)}`;
  if (b.channel === "character") return `${sign}${mag.toFixed(1)}`;
  return `${sign}${Math.round(mag) || mag.toFixed(1)}`;
}

/**
 * Float the +N / −N chips that belong to one metric/character/alert key up out
 * of their anchor (which must be position:relative). Tone-colored, auto-expiring.
 */
export function FloatingFeedback({
  channel,
  feedbackKey,
  placement = "right",
}: {
  channel: FeedbackBubble["channel"];
  feedbackKey: string;
  /** Where the chip sits relative to its (position:relative) anchor. */
  placement?: "right" | "below";
}) {
  // Select the stable array reference; filter in render. A selector that returns
  // a fresh `.filter(...)` array every call breaks Zustand v5's snapshot equality
  // check and spins into an infinite render loop ("Maximum update depth exceeded").
  const feedback = useStore((s) => s.feedback);
  const bubbles = useMemo(
    () => feedback.filter((b) => b.channel === channel && b.key === feedbackKey),
    [feedback, channel, feedbackKey],
  );
  if (!bubbles.length) return null;
  return (
    <span className={`fb-layer fb-layer--${placement}`} aria-hidden>
      {bubbles.map((b) => (
        <span key={b.id} className={`fb-bubble fb-bubble--${b.tone}`} title={b.reason}>
          {formatDelta(b)}
        </span>
      ))}
    </span>
  );
}
