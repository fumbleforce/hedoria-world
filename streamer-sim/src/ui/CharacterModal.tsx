import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import type { GameController } from "../game/controller";
import type { DmLine } from "../game/types";
import { ARCHETYPE_BY_ID } from "../game/archetypes";
import { avatarFor, relationshipLevel, revealedSheet, personalityProse, personalityTable, backstoryLayerLabel, type CharacterSheet, type RevealedSheet } from "../game/characters";
import { loadPortrait } from "../persist/imageStore";
import { useStoredImage } from "../persist/useStoredImage";
import { FloatingFeedback } from "./FeedbackBubbles";
import { formatClock } from "../game/time";

// Stable reference so the zustand selector doesn't return a fresh [] each render
// (which would trip "getSnapshot should be cached" and infinite-loop).
const EMPTY: DmLine[] = [];

const IS_DEV = import.meta.env.DEV;

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
  const revealed = revealedSheet(c);

  const close = () => useStore.getState().openCharacter(null);

  return (
    <div className="modal" onClick={close}>
      <div className="modal__card" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <span className="char__avatar">
            {portrait ? <img className="char__portrait" src={portrait} alt={c.handle} /> : avatarFor(c)}
            <FloatingFeedback channel="character" feedbackKey={c.id} />
          </span>
          <div className="char__id">
            <h2>
              {revealed.displayName ? `${revealed.displayName} ` : ""}
              <span className="char__handle-sub">{c.handle}</span>
            </h2>
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

        <PlayerSheet revealed={revealed} c={c} />

        {IS_DEV && <DevXray c={c} archLabel={arch?.label} />}

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

function PlayerSheet({ revealed, c }: { revealed: RevealedSheet; c: CharacterSheet }) {
  const history = c.interactionLog.slice(-12).reverse();

  return (
    <div className="char__sheet">
      <Row label="Name" value={revealed.displayName ?? LOCKED} locked={!revealed.displayName} />
      <Row label="Age" value={revealed.age != null ? String(revealed.age) : LOCKED} locked={revealed.age == null} />
      <Row label="Occupation" value={revealed.occupation ?? LOCKED} locked={!revealed.occupation} />
      <Row label="From" value={revealed.origin ?? LOCKED} locked={!revealed.origin} />
      <Row label="Personality" value={revealed.personalitySummary ?? LOCKED} locked={!revealed.personalitySummary} />
      <Row label="Types like" value={revealed.voiceProfile ?? LOCKED} locked={!revealed.voiceProfile} />
      {revealed.backstoryLayers.length > 0
        ? revealed.backstoryLayers.map((layer) => (
          <Row key={layer.id} label={backstoryLayerLabel(layer.trigger)} value={layer.text} />
        ))
        : <Row label="Background" value={LOCKED} locked />}
      <Row label="Quirk" value={revealed.quirks ?? LOCKED} locked={!revealed.quirks} />
      <Row label="Vibe" value={revealed.vibe ?? LOCKED} locked={!revealed.vibe} />
      <Row label="Wants" value={revealed.motiveSurface ?? LOCKED} locked={!revealed.motiveSurface} />
      <Row label="Messages" value={revealed.messages != null ? String(revealed.messages) : LOCKED} locked={revealed.messages == null} />
      <Row label="Tipped" value={revealed.tipped != null ? `$${revealed.tipped.toFixed(0)}` : LOCKED} locked={revealed.tipped == null} />
      <Row label="Affinity" value={revealed.affinity != null ? `${Math.round(revealed.affinity)}/100` : LOCKED} locked={revealed.affinity == null} />
      {revealed.attendance && <Row label="Attendance" value={revealed.attendance} />}
      {revealed.threat != null && <Row label="⚠ Threat" value={threatLabel(revealed.threat)} danger />}
      <Row label="History together" value={revealed.memory ?? LOCKED} locked={!revealed.memory} />
      {history.length > 0 && (
        <div className="char__history">
          <span className="char__label">History</span>
          <ul className="char__history-list">
            {history.map((e, i) => (
              <li key={i}><span className="char__history-kind">{e.kind}</span> {e.text}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function DevXray({ c, archLabel }: { c: CharacterSheet; archLabel?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="char__xray">
      <button
        type="button"
        className="char__xray-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span>DEV · X-RAY</span>
        <span className="char__xray-chevron">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="char__xray-body">
          <div className="char__xray-section">Identity</div>
          <Row label="Real name" value={c.realName || "—"} />
          <Row label="Name learned" value={c.displayName ? `yes — ${c.displayName}` : "no"} />
          <Row label="Handle" value={c.handle} />
          <Row label="Gender" value={c.gender} />
          <Row label="Age" value={String(c.age)} />
          <Row label="Occupation" value={c.occupation} />
          <Row label="Archetype" value={archLabel ?? c.archetypeId} />
          <Row label="Relationship" value={`${relationshipLevel(c.affinity)} · ${Math.round(c.affinity)}/100`} />

          <div className="char__xray-section">Personality</div>
          <Row label="Summary" value={personalityProse(c.personality)} />
          <PersonalityTable c={c} />
          {c.personality.fixation && <Row label="Fixation" value={c.personality.fixation} />}
          <Row label="Speech tic" value={c.personality.speechTic || "—"} />
          <Row label="From" value={`${c.origin} (${c.nativeLanguage})`} />
          <Row label="Types like" value={c.voiceProfile} />
          <Row label="Voice refined" value={c.voiceRefined ? "yes" : "no"} />

          <div className="char__xray-section">Drives</div>
          <Row label="Vibe" value={c.vibe || "—"} />
          <Row label="Wants" value={c.motive.surface} />
          <Row label="Need" value={c.motive.need} />
          <Row label="Fear" value={c.motive.fear} />
          <Row label="Boundary" value={c.motive.boundary} />
          <Row label="Quirk" value={c.quirks || "—"} />
          <Row label="Threat (raw)" value={String(c.threat)} danger={c.threat >= 2} />

          <div className="char__xray-section">Engagement</div>
          <Row label="Messages" value={String(c.messageCount)} />
          <Row label="Tipped" value={`$${c.tipped.toFixed(0)}`} />
          <Row label="Online" value={c.online ? "yes" : "no"} />
          <Row label="Attendance" value={`${c.attendanceStreak} streak · ${c.streamsAttended} total`} />
          <Row label="Memory" value={c.memory || "—"} />

          <div className="char__xray-section">Backstory</div>
          {c.backstoryLayers.map((layer) => (
            <Row key={layer.id} label={`Bio [${layer.trigger}]`} value={layer.text} />
          ))}
          {c.backstoryLayers.length === 0 && c.backstory && <Row label="Bio (legacy)" value={c.backstory} />}
          {c.backstoryLayers.length === 0 && !c.backstory && <Row label="Bio" value="(none yet)" />}
        </div>
      )}
    </div>
  );
}

function PersonalityTable({ c }: { c: CharacterSheet }) {
  const rows = personalityTable(c.personality);
  return (
    <table className="char__axes">
      <thead>
        <tr><th>Axis</th><th>Lvl</th><th>Read</th><th>Effect</th></tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.axis}>
            <td>{r.axis}</td>
            <td className={`char__axis-val ${r.value > 0 ? "is-pos" : r.value < 0 ? "is-neg" : ""}`}>
              {r.value > 0 ? `+${r.value}` : r.value}
            </td>
            <td>{r.word}</td>
            <td className="char__axis-effect">{r.effect}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const LOCKED = "??? — get to know them";

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

function Row({ label, value, danger, locked }: { label: string; value: string; danger?: boolean; locked?: boolean }) {
  return (
    <div className="char__row">
      <span className="char__label">{label}</span>
      <span className={`char__value ${danger ? "char__value--danger" : ""} ${locked ? "char__value--locked" : ""}`}>{value}</span>
    </div>
  );
}
