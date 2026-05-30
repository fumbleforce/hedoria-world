import { useEffect, useRef } from "react";
import { useStore } from "../state/store";
import type { GameController } from "../game/controller";

/** The Dungeon Master sidebar: the unfolding story, in prose. */
export function NarratorPanel({ controller }: { controller: GameController }) {
  const story = useStore((s) => s.story);
  const resolving = useStore((s) => s.resolving);
  const imageCache = useStore((s) => s.imageCache);
  const imageBusy = useStore((s) => s.imageBusy);
  const hasStory = useStore((s) => s.story.length > 0);
  const hasCharacter = useStore((s) => !!s.character.description.trim());
  const canGen = controller.canGenerateImages;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [story, resolving]);

  return (
    <section className="narrator">
      <div className="narrator__head">
        <span>📖 Narrator</span>
        {canGen && hasCharacter && hasStory && (
          <button
            className={`btn btn--mini ${imageBusy ? "is-loading" : ""}`}
            disabled={!!imageBusy}
            onClick={() => void controller.generateScene()}
            title="Generate an image of the current moment"
          >
            {imageBusy ? imageBusy + "…" : "📸 Visualize scene"}
          </button>
        )}
      </div>
      <div className="narrator__scroll" ref={ref}>
        {story.length === 0 && (
          <p className="rail__empty">
            The story of your stream unfolds here. Click a spot in the room and act, or type
            what you do.
          </p>
        )}
        {story.map((e) =>
          e.kind === "quote" ? (
            <p key={e.id} className="story story--quote">
              <span className="story__mic">🎙</span> {e.text}
            </p>
          ) : e.kind === "image" ? (
            <figure key={e.id} className="story story--image">
              {e.imageId && imageCache[e.imageId] ? (
                <button
                  className="story__imgbtn"
                  onClick={() => useStore.getState().openSettings("gallery")}
                >
                  <img src={imageCache[e.imageId]} alt={e.text} />
                </button>
              ) : (
                <div className="story__imgmissing">image saved to Gallery</div>
              )}
              <figcaption>{e.text}</figcaption>
            </figure>
          ) : (
            <p key={e.id} className={`story story--${e.kind}`}>{e.text}</p>
          ),
        )}
        {resolving && <p className="story story--pending is-loading">…the narrator is writing…</p>}
      </div>
    </section>
  );
}
