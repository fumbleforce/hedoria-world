import { useMemo } from "react";
import { useStore } from "../state/store";
import type { GameController } from "../game/controller";

/**
 * Render text with `@handle` mentions of KNOWN/ONLINE roster characters shown as
 * highlighted, clickable chips. Unknown handles stay plain so invented chatter
 * names don't all light up. Keeps the "I said your name" beat visible.
 */
export function MentionText({
  text,
  controller,
  onlineOnly = false,
}: {
  text: string;
  controller?: GameController;
  onlineOnly?: boolean;
}) {
  const roster = useStore((s) => s.roster);

  const byHandle = useMemo(() => {
    const map = new Map<string, { id: string; online: boolean }>();
    for (const c of Object.values(roster)) {
      map.set(c.handle.toLowerCase(), { id: c.id, online: c.online });
    }
    return map;
  }, [roster]);

  if (!text.includes("@")) return <>{text}</>;

  const parts = text.split(/(@[a-z0-9_]+)/gi);
  return (
    <>
      {parts.map((part, i) => {
        const m = /^@([a-z0-9_]+)$/i.exec(part);
        if (m) {
          const hit = byHandle.get(m[1].toLowerCase());
          if (hit && (!onlineOnly || hit.online)) {
            return (
              <span
                key={i}
                className="mention"
                onClick={controller ? () => controller.openCharacter(hit.id) : undefined}
                title={controller ? "Open profile / DM" : undefined}
              >
                {part}
              </span>
            );
          }
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}
