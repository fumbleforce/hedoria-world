import { useState } from "react";
import { useStore } from "../state/store";
import type { WorldNarrator } from "../dialogue/worldNarrator";

/**
 * Global free-text action prompt. Pinned to the bottom-centre of the
 * canvas, available in every mode (region, location, scene), so the
 * player can do arbitrary things at any time — "shout for help", "look
 * for tracks", "rummage in my pack" — instead of being confined to
 * clicking adjacent tiles or scene buttons.
 *
 * The intent (`freetext`) is mode-agnostic on the WorldNarrator side:
 * the system prompt picks the scene-flavoured or traversal-flavoured
 * dispatch based on the current store mode, so the same component
 * works as the scene's "what do you do?" line and as the map's "do
 * something other than walk" affordance. The submit button is locked
 * while a narration round-trip is in flight; the placeholder reflects
 * that state so the player gets immediate feedback.
 */
type Props = {
  worldNarrator: WorldNarrator;
};

export function ActionPrompt({ worldNarrator }: Props) {
  const [input, setInput] = useState("");
  const pending = useStore((s) => s.pendingNarrations);
  const mode = useStore((s) => s.mode);

  const busy = pending > 0;

  // The placeholder is the only mode-aware thing — it's a hint of the
  // *kind* of action that fits the current screen. The intent itself is
  // identical across modes.
  const placeholder = busy
    ? "Narrator is responding…"
    : mode === "scene"
      ? "What do you say or do?"
      : mode === "location"
        ? "Do something here — search a stall, hail a passer-by…"
        : "Do something — scan the horizon, shout, rest a moment…";

  return (
    <form
      className="actionPrompt"
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = input.trim();
        if (!trimmed || busy) return;
        setInput("");
        void worldNarrator.submitPlayerIntent({ kind: "freetext", text: trimmed });
      }}
    >
      <input
        className="actionPrompt__input"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={placeholder}
        disabled={busy}
        aria-label="Free-text action"
      />
      <button
        type="submit"
        className="actionPrompt__submit"
        disabled={busy || input.trim().length === 0}
      >
        {busy ? "…" : "Do"}
      </button>
    </form>
  );
}
