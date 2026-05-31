import { FloatingFeedback } from "./FeedbackBubbles";

/** Compact 0–100 meter with optional floating delta bubbles. */
export function MeterBar({
  label,
  value,
  color,
  metric,
  className = "meter",
}: {
  label: string;
  value: number;
  color: string;
  metric?: string;
  className?: string;
}) {
  const rounded = Math.round(value);
  return (
    <div className={className} title={`${label}: ${rounded}/100`}>
      <span className="meter__label">{label}</span>
      <span className="meter__track">
        <span className="meter__fill" style={{ width: `${value}%`, background: color }} />
      </span>
      <span className="meter__value">{rounded}</span>
      {metric && <FloatingFeedback channel="metric" feedbackKey={metric} />}
    </div>
  );
}
