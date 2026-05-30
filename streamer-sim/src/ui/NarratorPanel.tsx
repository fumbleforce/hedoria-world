import { useEffect, useRef } from "react";
import { useStore } from "../state/store";

/** The Dungeon Master sidebar: the unfolding story, in prose. */
export function NarratorPanel() {
  const story = useStore((s) => s.story);
  const resolving = useStore((s) => s.resolving);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [story, resolving]);

  return (
    <section className="narrator">
      <div className="narrator__head">📖 Narrator</div>
      <div className="narrator__scroll" ref={ref}>
        {story.length === 0 && (
          <p className="rail__empty">
            The story of your stream unfolds here. Click a spot in the room and act, or type
            what you do.
          </p>
        )}
        {story.map((e) => (
          <p key={e.id} className={`story story--${e.kind}`}>{e.text}</p>
        ))}
        {resolving && <p className="story story--pending">…the narrator is writing…</p>}
      </div>
    </section>
  );
}
