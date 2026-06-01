import { useMemo } from "react";
import { useStore } from "../state/store";
import { getBalance, DIFFICULTY_LEVELS } from "../game/balance";
import { isNoLimits } from "../game/content";
import { growthProjection, liveSubFractionPerBeat, subProjection, viewerDrivers } from "../game/derived";
import { masteryLevel } from "../game/mastery";
import { NICHES } from "../game/niches";
import { outfitVibeLabel } from "../game/outfits";
import { dominantOutfitVibe } from "../game/wardrobe";
import { SEGMENTS, type SegmentId } from "../game/segments";
import { multipliersFor } from "../game/shop";
import { shiftStatus, shiftStatusLabel, shiftWindowLabel, workedToday } from "../game/jobs";
import { formatClock } from "../game/time";

interface StatRow {
  label: string;
  value: string;
  warn?: boolean;
}

interface StatGroup {
  title: string;
  rows: StatRow[];
}

/** Compact stats readout — channel + live drivers; needs/hype live elsewhere. */
export function StatsPanel() {
  const metrics = useStore((s) => s.metrics);
  const session = useStore((s) => s.session);
  const audience = useStore((s) => s.audience);
  const roster = useStore((s) => s.roster);
  const streamNicheDraft = useStore((s) => s.streamNicheDraft);
  const brand = useStore((s) => s.brand);
  const equippedClothing = useStore((s) => s.equippedClothing);
  const inventory = useStore((s) => s.inventory);
  const contentTier = useStore((s) => s.settings.contentTier);
  const devMode = useStore((s) => s.settings.devMode);
  const difficulty = useStore((s) => s.settings.difficulty ?? "normal");
  const ownedUpgrades = useStore((s) => s.ownedUpgrades);
  const mastery = useStore((s) => s.mastery);
  const contentNovelty = useStore((s) => s.contentNovelty);
  const job = useStore((s) => s.job);
  const clock = useStore((s) => s.clock);

  const groups = useMemo(() => {
    const balance = getBalance(difficulty);
    const mult = multipliersFor(ownedUpgrades, balance);
    const drivers = viewerDrivers(metrics, mult);
    const growth = growthProjection(metrics, audience, metrics.currentViewers, balance);
    const subs = subProjection(metrics, roster, balance);
    const subPerBeat = session.isLive ? liveSubFractionPerBeat(metrics, roster, audience, balance) : 0;
    const nicheKey = session.isLive ? session.niche : streamNicheDraft;
    const freshness = nicheKey ? (contentNovelty[nicheKey] ?? 1) : 1;
    const showmanship = masteryLevel(mastery.showmanship ?? 0);
    const composure = masteryLevel(mastery.composure ?? 0);

    const channelRows: StatRow[] = [
      { label: "Handle", value: `@${brand.handle || "streamer"}` },
      {
        label: "Description",
        value: brand.description.trim()
          ? brand.description.length > 48
            ? `${brand.description.slice(0, 48)}…`
            : brand.description
          : "—",
      },
      {
        label: "Default niche",
        value: NICHES[brand.defaultNiche]?.label ?? brand.defaultNiche,
      },
      { label: "Followers", value: metrics.followers.toLocaleString() },
      { label: "Subs", value: metrics.subscribers.toLocaleString() },
      { label: "Cash", value: `$${metrics.cash.toFixed(0)}` },
    ];

    const liveRows: StatRow[] = session.isLive
      ? [
          { label: "Viewers", value: Math.round(metrics.currentViewers).toLocaleString() },
          { label: "Projected", value: String(drivers.projectedViewers) },
          { label: "Peak", value: metrics.peakViewers.toLocaleString() },
        ]
      : [{ label: "Stream", value: "offline" }];

    const setupRows: StatRow[] = [
      {
        label: session.isLive ? "Niche" : "Next stream",
        value: nicheKey ? (NICHES[nicheKey]?.label ?? nicheKey) : "—",
      },
      {
        label: "Outfit vibe",
        value: outfitVibeLabel(dominantOutfitVibe(equippedClothing, inventory)),
      },
      {
        label: "Difficulty",
        value: DIFFICULTY_LEVELS.find((d) => d.id === difficulty)?.label ?? difficulty,
      },
      {
        label: "Freshness",
        value: `${Math.round(freshness * 100)}%`,
        warn: freshness < 0.6,
      },
      {
        label: "Skills",
        value: `🎭 ${showmanship > 0 ? showmanship : "—"} · 🧘 ${composure > 0 ? composure : "—"}`,
      },
    ];

    const out: StatGroup[] = [
      { title: "Channel", rows: channelRows },
      { title: "Live", rows: liveRows },
      { title: "Setup", rows: setupRows },
    ];

    if (job) {
      const worked = workedToday(job, metrics.day);
      const status = shiftStatus(job, clock);
      const todayLabel = worked
        ? job.lastClockInOnTime
          ? "Worked (on time)"
          : "Worked (late)"
        : shiftStatusLabel(status);
      out.splice(2, 0, {
        title: "Day job",
        rows: [
          { label: "Role", value: job.title },
          { label: "Pay", value: `$${job.wage}/shift` },
          { label: "Shift", value: shiftWindowLabel(job) },
          { label: "Today", value: todayLabel, warn: status === "over" && !worked },
          {
            label: "Strikes",
            value: `${job.strikes}/3`,
            warn: job.strikes >= 2,
          },
          ...(status === "early" && !worked
            ? [{ label: "Opens", value: formatClock(job.shiftStart) }]
            : []),
        ],
      });
    }

    if (devMode) {
      const noLimits = isNoLimits(contentTier);
      const devRows: StatRow[] = [
        { label: "targetNamed", value: String(drivers.targetNamed) },
        { label: "anonFloor", value: String(drivers.anonFloor) },
        { label: "needsFactor", value: drivers.needsFactor.toFixed(2) },
        { label: "followers/beat", value: String(growth.passiveFollowersPerBeat) },
        { label: "sub frac/beat", value: subPerBeat.toFixed(3) },
        { label: "sub gain/day", value: String(subs.estimatedGain) },
        { label: "sub churn/day", value: String(subs.estimatedChurn) },
        { label: "friend+ regulars", value: String(subs.regularCount) },
      ];
      if (mult.productionQuality) {
        devRows.push({ label: "Production", value: String(mult.productionQuality) });
      }
      if (mult.viewer !== 1) devRows.push({ label: "Viewer mult", value: `×${mult.viewer.toFixed(2)}` });
      if (mult.hype !== 1) devRows.push({ label: "Hype gain", value: `×${mult.hype.toFixed(2)}` });
      if (mult.income !== 1) devRows.push({ label: "Income", value: `×${mult.income.toFixed(2)}` });
      devRows.push({ label: "Rent", value: `$${mult.rentPerDay}/day` });
      for (const [seg, v] of Object.entries(mult.segmentAppeal) as [SegmentId, number][]) {
        if (v) devRows.push({ label: SEGMENTS[seg].label, value: `+${v} appeal` });
      }
      if (noLimits) devRows.push({ label: "Horny", value: String(Math.round(metrics.horny)) });
      out.push({ title: "Dev", rows: devRows });
    }

    return out;
  }, [
    metrics,
    session.isLive,
    session.niche,
    audience,
    roster,
    streamNicheDraft,
    brand,
    equippedClothing,
    inventory,
    contentTier,
    difficulty,
    devMode,
    ownedUpgrades,
    mastery,
    contentNovelty,
    job,
    clock,
  ]);

  return (
    <section className="statspanel">
      <div className="statspanel__head">
        <span>Stats</span>
      </div>
      {groups.map((g) => (
        <div key={g.title} className="statspanel__group">
          <div className="statspanel__group-head">{g.title}</div>
          <ul className="statspanel__list">
            {g.rows.map((r) => (
              <li key={`${g.title}-${r.label}`} className="statspanel__row">
                <span className="statspanel__label">{r.label}</span>
                <span className={`statspanel__value${r.warn ? " statspanel__value--warn" : ""}`}>{r.value}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
