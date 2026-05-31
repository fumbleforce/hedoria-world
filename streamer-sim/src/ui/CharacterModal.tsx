import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import type { GameController } from "../game/controller";
import type { DmLine } from "../game/types";
import { ARCHETYPE_BY_ID } from "../game/archetypes";
import { avatarFor, relationshipLevel } from "../game/characters";
import { loadPortrait } from "../persist/imageStore";
import { useStoredImage } from "../persist/useStoredImage";
import { formatClock } from "../game/time";

// Stable reference so the zustand selector doesn't return a fresh [] each render
// (which would trip "getSnapshot should be cached" and infinite-loop).
const EMPTY: DmLine[] = [];

/** Character sheet + 1:1 direct-message panel. */
export function CharacterModal({ controller }: { controller: GameController }) {
  const id = useStore((s) => s.openCharId);
  const roster = useStore((s) => s.roster);
  const convo = useStore((s) => (s.openCharId ? s.dmThreads[s.openCharId] ?? EMPTY : EMPTY));
  const busy = useStore((s) => s.dmBusy);
  const portraitBusyId = useStore((s) => s.portraitBusyId);
  const [text, setText] = useState("");
  const [portrait, setPortrait] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const hasPortrait = id ? roster[id]?.hasPortrait : false;
  // Load the cached portrait blob whenever it exists / regenerates.
  useEffect(() => {
    let alive = true;
    if (id && hasPortrait) {
      void loadPortrait(id).then((url) => { if (alive) setPortrait(url); });
    } else {
      setPortrait(null);
    }
    return () => { alive = false; };
  }, [id, hasPortrait, portraitBusyId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [convo, busy]);

  // Keep the message box focused after a reply lands (the input is disabled
  // while busy, which drops focus; refocus when it frees up).
  useEffect(() => {
    if (!busy) inputRef.current?.focus();
  }, [busy, convo.length]);

  if (!id) return null;
  const c = roster[id];
  if (!c) return null;
  const arch = ARCHETYPE_BY_ID[c.archetypeId];
  const portraitBusy = portraitBusyId === id;

  const close = () => useStore.getState().openCharacter(null);

  return (
    <div className="modal" onClick={close}>
      <div className="modal__card" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <span className="char__avatar">
            {portrait ? <img className="char__portrait" src={portrait} alt={c.handle} /> : avatarFor(c)}
          </span>
          <div className="char__id">
            <h2>{c.displayName ? `${c.displayName} ` : ""}<span className="char__handle-sub">{c.handle}</span></h2>
            <span className="char__rel">
              {relationshipLevel(c.affinity)} · {arch?.label}
              {c.online ? " · online" : ` · last seen ${formatClock(c.lastSeenClock)}`}
            </span>
          </div>
          <button className="modal__close" onClick={close}>✕</button>
        </div>

        {controller.canGeneratePortrait && (
          <div className="char__portrait-actions">
            <button
              className="btn btn--ghost"
              disabled={portraitBusy}
              onClick={() => void controller.generatePortrait(c.id)}
            >
              {portraitBusy ? "Generating…" : c.hasPortrait ? "Regenerate portrait" : "Generate portrait"}
            </button>
          </div>
        )}

        <div className="char__sheet">
          {c.backstory && <Row label="Backstory" value={c.backstory} />}
          {c.quirks && <Row label="Quirk" value={c.quirks} />}
          <Row label="Vibe" value={c.vibe} />
          <Row label="Wants" value={c.wants} />
          <Row label="Messages" value={String(c.messageCount)} />
          <Row label="Tipped" value={`$${c.tipped.toFixed(0)}`} />
          <Row label="Affinity" value={`${Math.round(c.affinity)}/100`} />
          {c.attendanceStreak >= 2 && <Row label="Attendance" value={`${c.attendanceStreak} streams running (${c.streamsAttended} total)`} />}
          {c.threat >= 1 && <Row label="⚠ Threat" value={threatLabel(c.threat)} danger />}
          {c.memory && <Row label="You remember" value={c.memory} />}
        </div>

        <div className="dm">
          <div className="dm__head">Direct message</div>
          <div className="dm__scroll" ref={scrollRef}>
            {convo.length === 0 && <p className="rail__empty">Say hi — see what they're like one-on-one.</p>}
            {convo.map((l, i) => (
              <DmMessage key={i} line={l} handle={c.handle} />
            ))}
            {busy && <div className="dm__line dm__line--them dm__pending is-loading">…typing…</div>}
          </div>
          <form
            className="dm__form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!text.trim() || busy) return;
              void controller.sendDm(text);
              setText("");
              inputRef.current?.focus();
            }}
          >
            <input
              ref={inputRef}
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Message…"
            />
            <button className="btn btn--primary" type="submit" disabled={busy || !text.trim()}>Send</button>
          </form>
        </div>
      </div>
    </div>
  );
}

function DmMessage({ line, handle }: { line: DmLine; handle: string }) {
  const imageUrl = useStoredImage(line.imageId);
  const who = line.role === "me" ? "You" : handle;
  if (line.kind === "image") {
    return (
      <div className={`dm__line dm__line--${line.role}`}>
        <b>{who}:</b>{" "}
        <span className="dm__kind dm__kind--image">{line.text || "sent an image"}</span>
        {imageUrl ? <img className="dm__thumb" src={imageUrl} alt={line.text || "dm image"} /> : <span className="dm__imgmissing">image unavailable</span>}
      </div>
    );
  }
  if (line.kind === "gift") {
    return (
      <div className={`dm__line dm__line--${line.role}`}>
        <b>{who}:</b> <span className="dm__kind dm__kind--gift">{line.amount ? `💸 $${line.amount}` : "🎁"} {line.text}</span>
      </div>
    );
  }
  if (line.kind === "system") {
    return (
      <div className={`dm__line dm__line--${line.role}`}>
        <span className="dm__kind dm__kind--system">{line.text}</span>
      </div>
    );
  }
  return (
    <div className={`dm__line dm__line--${line.role}`}>
      <b>{who}:</b> {line.text}
    </div>
  );
}

function threatLabel(threat: number): string {
  if (threat >= 3) return "level 3 — real-world threat";
  if (threat === 2) return "level 2 — getting personal";
  return "level 1 — watch this one";
}

function Row({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="char__row">
      <span className="char__label">{label}</span>
      <span className={`char__value ${danger ? "char__value--danger" : ""}`}>{value}</span>
    </div>
  );
}
