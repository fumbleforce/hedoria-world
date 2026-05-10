import { useState } from "react";
import type { PackNpc } from "../schema/packSchema";

type DialogueMessage = {
  role: "player" | "npc";
  text: string;
};

type Props = {
  npc?: PackNpc;
  messages: DialogueMessage[];
  onSend: (text: string) => void;
};

export function DialoguePanel({ npc, messages, onSend }: Props) {
  const [input, setInput] = useState("");
  return (
    <section className="panel">
      <h2>Dialogue {npc ? `- ${npc.name}` : ""}</h2>
      <div className="dialogueLog">
        {messages.map((msg, index) => (
          <p key={`${msg.role}-${index}`}>
            <strong>{msg.role === "player" ? "You" : npc?.name ?? "NPC"}:</strong> {msg.text}
          </p>
        ))}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!input.trim()) return;
          onSend(input.trim());
          setInput("");
        }}
        className="dialogueForm"
      >
        <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Say something..." />
        <button type="submit">Send</button>
      </form>
    </section>
  );
}
