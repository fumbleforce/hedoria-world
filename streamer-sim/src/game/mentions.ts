/**
 * @mention parsing. Calling a viewer out by handle in front of the whole chat
 * is the most intentional personalization signal, so it earns a small targeted
 * affinity bonus (live/public actions only — a DM is already a 1:1). Pure: maps
 * @handle tokens in free text to roster character ids, matching the same
 * case-insensitive handle convention parseChat uses.
 */

import type { Roster } from "./characters";

const MENTION_RE = /@([a-z0-9_]+)/gi;

/**
 * Return the distinct roster character ids referenced by @handle tokens in
 * `text`. Unknown handles are ignored. `onlineOnly` (default true) restricts to
 * viewers currently watching, since you can only call out who's in the room.
 */
export function extractMentions(text: string, roster: Roster, onlineOnly = true): string[] {
  if (!text.includes("@")) return [];
  const byHandle = new Map(Object.values(roster).map((c) => [c.handle.toLowerCase(), c]));
  const ids = new Set<string>();
  for (const m of text.matchAll(MENTION_RE)) {
    const handle = m[1].toLowerCase();
    const c = byHandle.get(handle);
    if (!c) continue;
    if (onlineOnly && !c.online) continue;
    ids.add(c.id);
  }
  return [...ids];
}

/** True if the text contains at least one @token (cheap pre-check for the UI). */
export function hasMention(text: string): boolean {
  MENTION_RE.lastIndex = 0;
  return /@[a-z0-9_]+/i.test(text);
}
