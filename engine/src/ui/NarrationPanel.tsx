import { useEffect, useRef } from "react";
import { useStore } from "../state/store";
import type { IndexedWorld } from "../world/indexer";

/**
 * The persistent narration rail on the left side of the screen. It
 * shows every player intent, narrator response, NPC line, and system
 * notice in chronological order — the single source of truth for "what
 * just happened in the world". Auto-scrolls to the bottom whenever a
 * new entry arrives so the latest line is always visible without the
 * player having to scroll manually.
 *
 * The panel is purely a view; it never mutates state. Player actions
 * arrive through the map / scene UIs, route through `WorldNarrator`,
 * and land here as side-effect entries.
 */
export function NarrationPanel({ world }: { world: IndexedWorld }) {
  const storyLog = useStore((s) => s.storyLog);
  const pending = useStore((s) => s.pendingNarrations);
  const pendingNarrationText = useStore((s) => s.pendingNarrationText);
  const listRef = useRef<HTMLOListElement | null>(null);

  // Resolve an npcId to a friendly display name so speaker labels read
  // "Saska Vorin" instead of "world-npc-saska-vorin".
  const speakerLabel = (npcId: string | undefined): string => {
    if (!npcId) return "NPC";
    const npc = world.world.npcs[npcId];
    return npc?.name?.trim() || npcId;
  };

  // Pin to the bottom whenever a new entry arrives. We do this in an
  // effect (not inline during render) so the layout has had a chance to
  // settle before we measure scrollHeight.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [storyLog.length, pending]);

  return (
    <aside className="narrationPanel">
      <header className="narrationPanel__header">
        <h2>Narration</h2>
        {pending > 0 ? (
          <span className="narrationPanel__pending">
            <span className="narrationPanel__dot" />
            Narrator responding…
          </span>
        ) : null}
      </header>
      {storyLog.length === 0 ? (
        <p className="narrationPanel__empty">
          The world is quiet. Walk somewhere — the narrator will pick up the
          thread.
        </p>
      ) : (
        <ol ref={listRef} className="narrationPanel__list">
          {storyLog.map((entry) => (
            <li
              key={entry.id}
              className={`narrationPanel__entry narrationPanel__entry--${entry.kind}`}
            >
              {entry.kind === "say" ? (
                <strong className="narrationPanel__speaker">
                  {speakerLabel(entry.npcId)}
                </strong>
              ) : null}
              <span className="narrationPanel__text">{entry.text}</span>
            </li>
          ))}
          {pendingNarrationText ? (
            <li className="narrationPanel__entry narrationPanel__entry--pending">
              <span className="narrationPanel__text">{pendingNarrationText}</span>
            </li>
          ) : null}
        </ol>
      )}
    </aside>
  );
}
