import { useEffect, useRef } from "react";
import { useStore } from "../state/store";
import type { GameController } from "../game/controller";
import type { ChatMessage } from "../game/types";

const KIND_CLASS: Record<string, string> = {
  hype: "chat__msg--hype",
  troll: "chat__msg--troll",
  flirty: "chat__msg--flirty",
  creepy: "chat__msg--creepy",
  donation: "chat__msg--money",
  sub: "chat__msg--money",
  follow: "chat__msg--follow",
  raid: "chat__msg--money",
  mod: "chat__msg--mod",
  system: "chat__msg--system",
  streamer: "chat__msg--streamer",
};

export function ChatPanel({ controller }: { controller: GameController }) {
  const chat = useStore((s) => s.chat);
  const isLive = useStore((s) => s.session.isLive);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat]);

  return (
    <section className="chat">
      <div className="chat__head">
        <span>Stream Chat</span>
        <span className={isLive ? "chat__dot chat__dot--live" : "chat__dot"}>{isLive ? "live" : "offline"}</span>
      </div>
      <div className="chat__scroll" ref={ref}>
        {chat.length === 0 && <p className="rail__empty">Go live to fill the chat.</p>}
        {chat.map((m) => (
          <ChatRow key={m.id} m={m} onOpen={() => m.characterId && controller.openCharacter(m.characterId)} />
        ))}
      </div>
    </section>
  );
}

function ChatRow({ m, onOpen }: { m: ChatMessage; onOpen: () => void }) {
  if (m.kind === "system") return <div className="chat__msg chat__msg--system">{m.text}</div>;
  const cls = KIND_CLASS[m.kind] ?? "";
  const badge =
    m.kind === "donation" ? `💸 $${m.amount}`
      : m.kind === "sub" ? "★ sub"
        : m.kind === "follow" ? "+ follow"
          : m.kind === "mod" ? "🛡"
            : null;
  return (
    <div className={`chat__msg ${cls}`}>
      {badge && <span className="chat__badge">{badge}</span>}
      <span
        className={`chat__user ${m.characterId ? "chat__user--known" : ""}`}
        onClick={m.characterId ? onOpen : undefined}
        title={m.characterId ? "Open profile / DM" : undefined}
      >
        {m.user}
      </span>
      <span className="chat__text">{m.text}</span>
    </div>
  );
}
