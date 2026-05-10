import type {
  EngagementGroup,
  EngagementState,
  Engagement,
} from "../state/store";

/**
 * Pure helpers around the engagement state machine. All mutation goes
 * through the dispatcher; this module just answers structural questions:
 *
 *   - Which transitions are valid right now?
 *   - Is the player free to leave the scene?
 *   - What action verbs should the UI surface for a given group?
 *
 * Splitting these out keeps `narrator.ts` focused on tool-call wiring and
 * keeps the UI from importing the dispatcher just to label a button.
 */

export const ENGAGEMENT_TRANSITIONS: Record<EngagementState, EngagementState[]> = {
  idle: ["engaged"],
  engaged: ["idle", "locked"],
  // From `locked` we expect an explicit unlock (back to engaged) before idle.
  locked: ["engaged"],
};

export function canTransition(
  from: EngagementState,
  to: EngagementState,
): boolean {
  return ENGAGEMENT_TRANSITIONS[from].includes(to);
}

export function isPlayerLocked(engagement: Engagement): boolean {
  if (engagement.lockReason) return true;
  for (const g of Object.values(engagement.groups)) {
    if (g.state === "locked") return true;
  }
  return false;
}

export function describeLock(engagement: Engagement): string | null {
  if (engagement.lockReason) return engagement.lockReason;
  for (const g of Object.values(engagement.groups)) {
    if (g.state === "locked") return `${g.name} is holding you in place.`;
  }
  return null;
}

/**
 * Return the verbs the UI should show on a group card given its current
 * state. Lock-aware: if the scene is locked, the player can't disengage
 * even from idle groups.
 */
export type EngagementAction = "talk" | "attack" | "trade" | "leave" | "engage";

export function actionsFor(
  group: EngagementGroup,
  engagement: Engagement,
): EngagementAction[] {
  const playerLocked = isPlayerLocked(engagement);
  switch (group.state) {
    case "idle":
      return ["engage"];
    case "engaged":
      return playerLocked ? ["talk", "attack"] : ["talk", "attack", "trade", "leave"];
    case "locked":
      return ["talk", "attack"];
  }
}

/**
 * Reduce an engagement record to a sorted list of cards for the UI. Locked
 * groups float to the top, then engaged, then idle — mirroring how
 * tabletop GMs draw attention to imminent threats first.
 */
export function sortedGroupsForView(engagement: Engagement): EngagementGroup[] {
  const order: Record<EngagementState, number> = { locked: 0, engaged: 1, idle: 2 };
  return Object.values(engagement.groups)
    .slice()
    .sort((a, b) => {
      const da = order[a.state];
      const db = order[b.state];
      if (da !== db) return da - db;
      return a.name.localeCompare(b.name);
    });
}
