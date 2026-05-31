import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import type { GameController } from "../game/controller";
import type { StoryEntry } from "../game/types";
import { MentionText } from "./MentionText";

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
  const [lightbox, setLightbox] = useState<{ src: string; cap: string } | null>(null);

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
        {story.map((e) => (
          <StoryLine key={e.id} entry={e} imageCache={imageCache} onZoom={setLightbox} controller={controller} />
        ))}
        {resolving && <p className="story story--pending is-loading">…the narrator is writing…</p>}
      </div>
      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <img src={lightbox.src} alt={lightbox.cap} onClick={(e) => e.stopPropagation()} />
          <div className="lightbox__cap">{lightbox.cap}</div>
        </div>
      )}
    </section>
  );
}

/** A single narrator line with hover edit/delete controls; edits persist. */
function StoryLine({
  entry,
  imageCache,
  onZoom,
  controller,
}: {
  entry: StoryEntry;
  imageCache: Record<string, string>;
  onZoom: (lb: { src: string; cap: string }) => void;
  controller: GameController;
}) {
  const editStory = useStore((s) => s.editStory);
  const deleteStory = useStore((s) => s.deleteStory);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.text);

  const save = () => {
    const t = draft.trim();
    if (t && t !== entry.text) editStory(entry.id, t);
    setEditing(false);
  };
  const startEdit = () => {
    setDraft(entry.text);
    setEditing(true);
  };

  if (editing) {
    return (
      <div className={`story story--${entry.kind} story--editing`}>
        <textarea
          className="story__edit"
          value={draft}
          autoFocus
          rows={Math.min(8, Math.max(2, Math.ceil(draft.length / 48)))}
          onChange={(ev) => setDraft(ev.target.value)}
          onKeyDown={(ev) => {
            if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) save();
            if (ev.key === "Escape") setEditing(false);
          }}
        />
        <div className="story__editbar">
          <button className="btn btn--mini btn--primary" onClick={save}>Save</button>
          <button className="btn btn--mini" onClick={() => setEditing(false)}>Cancel</button>
          <span className="story__edithint">⌘/Ctrl+Enter to save · Esc to cancel</span>
        </div>
      </div>
    );
  }

  const tools = (
    <span className="story__tools">
      <button className="story__tool" title="Edit" onClick={startEdit}>✎</button>
      <button className="story__tool story__tool--danger" title="Delete" onClick={() => deleteStory(entry.id)}>🗑</button>
    </span>
  );

  if (entry.kind === "image") {
    return (
      <figure className="story story--image">
        {tools}
        {entry.imageId && imageCache[entry.imageId] ? (
          <button
            className="story__imgbtn"
            onClick={() => onZoom({ src: imageCache[entry.imageId!], cap: entry.text })}
          >
            <img src={imageCache[entry.imageId]} alt={entry.text} />
          </button>
        ) : (
          <div className="story__imgmissing">image saved to Gallery</div>
        )}
        <figcaption>{entry.text}{entry.edited && <span className="story__edited" title="edited"> ·edited</span>}</figcaption>
      </figure>
    );
  }

  if (entry.kind === "quote") {
    return (
      <p className="story story--quote">
        {tools}
        <span className="story__mic">🎙</span> <MentionText text={entry.text} controller={controller} />
        {entry.edited && <span className="story__edited" title="edited"> ·edited</span>}
      </p>
    );
  }

  return (
    <p className={`story story--${entry.kind}`}>
      {tools}
      <MentionText text={entry.text} controller={controller} />
      {entry.edited && <span className="story__edited" title="edited"> ·edited</span>}
    </p>
  );
}
