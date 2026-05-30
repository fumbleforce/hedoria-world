import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import type { GameController } from "../game/controller";
import type { DmLine } from "../game/types";
import { ARCHETYPE_BY_ID } from "../game/archetypes";
import { avatarFor, relationshipLevel } from "../game/characters";
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
  const [text, setText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  const close = () => useStore.getState().openCharacter(null);

  return (
    <div className="modal" onClick={close}>
      <div className="modal__card" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <span className="char__avatar">{avatarFor(c)}</span>
          <div className="char__id">
            <h2>{c.handle}</h2>
            <span className="char__rel">
              {relationshipLevel(c.affinity)} · {arch?.label}
              {c.online ? " · online" : ` · last seen ${formatClock(c.lastSeenClock)}`}
            </span>
          </div>
          <button className="modal__close" onClick={close}>✕</button>
        </div>

        <div className="char__sheet">
          <Row label="Vibe" value={c.vibe} />
          <Row label="Wants" value={c.wants} />
          <Row label="Messages" value={String(c.messageCount)} />
          <Row label="Tipped" value={`$${c.tipped.toFixed(0)}`} />
          <Row label="Affinity" value={`${Math.round(c.affinity)}/100`} />
          {c.threat >= 1 && <Row label="⚠ Threat" value={`level ${c.threat}`} danger />}
          {c.memory && <Row label="You remember" value={c.memory} />}
        </div>

        <div className="dm">
          <div className="dm__head">Direct message</div>
          <div className="dm__scroll" ref={scrollRef}>
            {convo.length === 0 && <p className="rail__empty">Say hi — see what they're like one-on-one.</p>}
            {convo.map((l, i) => (
              <div key={i} className={`dm__line dm__line--${l.role}`}>
                <b>{l.role === "me" ? "You" : c.handle}:</b> {l.text}
              </div>
            ))}
            {busy && <div className="dm__line dm__line--them dm__pending">…typing…</div>}
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

function Row({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="char__row">
      <span className="char__label">{label}</span>
      <span className={`char__value ${danger ? "char__value--danger" : ""}`}>{value}</span>
    </div>
  );
}
