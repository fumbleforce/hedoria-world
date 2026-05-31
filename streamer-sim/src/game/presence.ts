/**
 * Presence: who is watching right now. Named characters drift online/offline
 * over the night and new ones arrive, seeded from archetypes. The economic
 * segment populations (segments.ts) are derived from how many characters of each
 * segment are currently online, so the spine math and the named cast stay in
 * sync.
 */

import { ARCHETYPE_BY_ID } from "./archetypes";
import {
  rollArchetype,
  seedCharacter,
  type CharacterSheet,
  type Roster,
} from "./characters";
import { SEGMENT_IDS, type AudienceState, type SegmentId } from "./segments";
import { chance, pick } from "../rng/rng";
import { BALANCE } from "./balance";

export interface PresenceResult {
  roster: Roster;
  online: string[];
  /** Newly-arrived character ids this tick (for "X just joined" flavor). */
  arrivals: string[];
  /** Characters who left this tick. */
  departures: string[];
}

/**
 * Advance presence by one beat. `targetSize` scales with followers/hype so a
 * bigger streamer pulls a bigger named cast. Returns a new roster + online list.
 */
export function advancePresence(
  roster: Roster,
  clock: number,
  intensity: number,
  reputation: number,
  targetNamed: number,
  audience: AudienceState,
): PresenceResult {
  const next: Roster = { ...roster };
  const arrivals: string[] = [];
  const departures: string[] = [];

  const onlineNow = Object.values(next).filter((c) => c.online);

  // Departures: some online folks wander off (lower affinity = likelier to go).
  // A strongly dissatisfied segment empties faster — pushing content the room
  // dislikes (e.g. spicy at a cozy crowd) visibly thins it out.
  for (const c of onlineNow) {
    const seg = ARCHETYPE_BY_ID[c.archetypeId]?.segment ?? "cozy";
    const sat = audience[seg]?.satisfaction ?? 55;
    const dislikeBoost = (Math.max(0, 55 - sat) / 55) * BALANCE.readiness.leaveOnDislikeBoost;
    const leaveP = 0.08 + (1 - c.affinity / 100) * 0.07 + dislikeBoost;
    if (chance(leaveP)) {
      next[c.id] = { ...c, online: false, lastSeenClock: clock };
      departures.push(c.id);
    }
  }

  let onlineCount = Object.values(next).filter((c) => c.online).length;

  // Returnees: known offline characters drift back in.
  const offline = Object.values(next).filter((c) => !c.online);
  for (const c of offline) {
    if (onlineCount >= targetNamed) break;
    const returnP = 0.05 + (c.affinity / 100) * 0.12;
    if (chance(returnP)) {
      next[c.id] = { ...c, online: true, lastSeenClock: clock };
      arrivals.push(c.id);
      onlineCount += 1;
    }
  }

  // New arrivals: spawn fresh named characters until we approach the target.
  let guard = 0;
  while (onlineCount < targetNamed && guard < 6) {
    guard += 1;
    if (!chance(0.6 + reputation * 0.1)) break;
    const arch = rollArchetype(intensity, /* weightStalkers */ chance(0.08 + intensity * 0.03));
    const c = seedCharacter(arch, clock);
    next[c.id] = c;
    arrivals.push(c.id);
    onlineCount += 1;
  }

  const online = Object.values(next)
    .filter((c) => c.online)
    .map((c) => c.id);
  return { roster: next, online, arrivals, departures };
}

/** Derive segment populations from the online named cast + an anonymous floor. */
export function audienceFromPresence(
  roster: Roster,
  online: string[],
  prev: AudienceState,
  anonFloor: number,
  segmentBias?: Partial<Record<SegmentId, number>>,
): AudienceState {
  const counts: Record<SegmentId, number> = {
    hype: 0, lonely: 0, simps: 0, trolls: 0, cozy: 0, whales: 0, stalkers: 0,
  };
  for (const id of online) {
    const c = roster[id];
    if (!c) continue;
    const seg = ARCHETYPE_BY_ID[c.archetypeId]?.segment ?? "cozy";
    counts[seg] += 1;
  }
  // Anonymous masses spread across the friendlier segments, biased by the niche
  // /gear you've invested in (so over time you attract the crowd you built for).
  const anonSpread = biasedAnonSpread(segmentBias);
  for (let i = 0; i < anonFloor; i += 1) counts[pick(anonSpread)] += 1;

  const out = {} as AudienceState;
  for (const id of SEGMENT_IDS) {
    out[id] = {
      population: counts[id],
      satisfaction: prev[id]?.satisfaction ?? 55,
    };
  }
  return out;
}

/**
 * Build the weighted pool the anonymous floor is distributed across. Base pool
 * favours the friendlier segments; a positive bias adds extra slots for that
 * segment, a negative one removes them — so investing in a niche/décor pulls
 * that crowd in over time.
 */
function biasedAnonSpread(bias?: Partial<Record<SegmentId, number>>): SegmentId[] {
  const base: SegmentId[] = ["cozy", "hype", "lonely", "cozy", "hype"];
  if (!bias) return base;
  const pool = [...base];
  for (const [seg, w] of Object.entries(bias) as [SegmentId, number][]) {
    const slots = Math.round(w * 6); // bias is roughly -1..1 after scaling
    if (slots > 0) for (let i = 0; i < slots; i += 1) pool.push(seg);
    else if (slots < 0) {
      for (let i = 0; i < -slots; i += 1) {
        const idx = pool.indexOf(seg);
        if (idx >= 0) pool.splice(idx, 1);
      }
    }
  }
  return pool.length ? pool : base;
}

/** Reset everyone offline (called when a stream ends / new stream begins). */
export function clearPresence(roster: Roster): Roster {
  const next: Roster = {};
  for (const [id, c] of Object.entries(roster)) next[id] = { ...c, online: false };
  return next;
}
