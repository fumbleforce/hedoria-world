import { useState } from "react";
import { useStore, type Character } from "../state/store";
import type { ImageProvider } from "../llm/imageAdapter";
import { diag } from "../diag/log";

/**
 * Barebones character panel — both viewer and creator/editor in one
 * modal. If no character has been authored yet (or the player clicks
 * Edit), the form is shown; otherwise the read-only summary is shown
 * with the generated portrait.
 *
 * Portrait generation calls the same `ImageProvider` the tile cache
 * uses, but with a portrait-specific prompt and aspect ratio. The
 * result is stored as a base64 data URL inside the character object
 * so it survives reloads via localStorage (see `store.ts`).
 */
type Props = {
  imageProvider: ImageProvider;
  onClose: () => void;
};

export function CharacterPanel({ imageProvider, onClose }: Props) {
  const character = useStore((s) => s.character);
  const setCharacter = useStore((s) => s.setCharacter);

  // If we don't have a character yet, default straight into edit mode.
  // After saving once, the player gets the view layout and can re-open
  // edit mode explicitly.
  const [editing, setEditing] = useState<boolean>(character === null);

  return (
    <div className="modal" onClick={onClose}>
      <div
        className="modal__inner characterPanel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__header">
          <h2>Character</h2>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>

        {editing || character === null ? (
          <CharacterForm
            initial={character}
            imageProvider={imageProvider}
            onSaved={(c) => {
              setCharacter(c);
              setEditing(false);
            }}
            onCancel={() =>
              character === null ? onClose() : setEditing(false)
            }
          />
        ) : (
          <CharacterView
            character={character}
            imageProvider={imageProvider}
            onEdit={() => setEditing(true)}
            onPortraitUpdated={(portraitDataUrl) =>
              setCharacter({ ...character, portraitDataUrl })
            }
          />
        )}
      </div>
    </div>
  );
}

// --------------------------------------------------------------- view

function CharacterView({
  character,
  imageProvider,
  onEdit,
  onPortraitUpdated,
}: {
  character: Character;
  imageProvider: ImageProvider;
  onEdit: () => void;
  onPortraitUpdated: (dataUrl: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const regenerate = async () => {
    setBusy(true);
    setError(null);
    try {
      const dataUrl = await generatePortrait(imageProvider, character);
      onPortraitUpdated(dataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="characterPanel__body">
      <div className="characterPanel__portraitWrap">
        <Portrait dataUrl={character.portraitDataUrl} name={character.name} />
        <button
          type="button"
          className="characterPanel__regen"
          onClick={() => void regenerate()}
          disabled={busy}
          title="Generate a new portrait from the current visual description."
        >
          {busy ? "Generating…" : "Regenerate portrait"}
        </button>
        {error ? (
          <p className="characterPanel__error">{error}</p>
        ) : null}
      </div>

      <div className="characterPanel__info">
        <h3 className="characterPanel__name">{character.name || "Unnamed"}</h3>

        <section className="characterPanel__section">
          <h4>Background</h4>
          <p>{character.background || <em>(none)</em>}</p>
        </section>

        <section className="characterPanel__section">
          <h4>Appearance</h4>
          <p>{character.visual || <em>(none)</em>}</p>
        </section>

        <div className="characterPanel__actions">
          <button type="button" onClick={onEdit}>
            Edit
          </button>
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------------------------- form

function CharacterForm({
  initial,
  imageProvider,
  onSaved,
  onCancel,
}: {
  initial: Character | null;
  imageProvider: ImageProvider;
  onSaved: (c: Character) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [background, setBackground] = useState(initial?.background ?? "");
  const [visual, setVisual] = useState(initial?.visual ?? "");
  const [portraitDataUrl, setPortraitDataUrl] = useState<string | undefined>(
    initial?.portraitDataUrl,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = name.trim().length > 0;

  const draft: Character = {
    name: name.trim(),
    background: background.trim(),
    visual: visual.trim(),
    portraitDataUrl,
  };

  const generate = async () => {
    if (!canSave) {
      setError("Add a name and visual description first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const dataUrl = await generatePortrait(imageProvider, draft);
      setPortraitDataUrl(dataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="characterPanel__body"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSave) onSaved(draft);
      }}
    >
      <div className="characterPanel__portraitWrap">
        <Portrait dataUrl={portraitDataUrl} name={name} />
        <button
          type="button"
          className="characterPanel__regen"
          onClick={() => void generate()}
          disabled={busy || !canSave}
          title="Generate a portrait from the current visual description."
        >
          {busy ? "Generating…" : "Generate portrait"}
        </button>
        {error ? <p className="characterPanel__error">{error}</p> : null}
      </div>

      <div className="characterPanel__info">
        <label className="characterPanel__field">
          <span>Name</span>
          <input
            type="text"
            value={name}
            maxLength={64}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Sera of the Riverflats"
            autoFocus
          />
        </label>

        <label className="characterPanel__field">
          <span>Background</span>
          <textarea
            value={background}
            rows={4}
            maxLength={2000}
            onChange={(e) => setBackground(e.target.value)}
            placeholder="A short sketch of who they are, where they're from, what they want."
          />
        </label>

        <label className="characterPanel__field">
          <span>Appearance</span>
          <textarea
            value={visual}
            rows={4}
            maxLength={1000}
            onChange={(e) => setVisual(e.target.value)}
            placeholder="Hair, eyes, build, clothing, scars, mood — anything the portrait should show."
          />
        </label>

        <div className="characterPanel__actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" disabled={!canSave}>
            Save
          </button>
        </div>
      </div>
    </form>
  );
}

// -------------------------------------------------------------- shared

function Portrait({
  dataUrl,
  name,
}: {
  dataUrl: string | undefined;
  name: string;
}) {
  // Compute deterministic initials so the placeholder still feels
  // "personal" even before the model has run.
  const initials = (name || "?")
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase())
    .slice(0, 2)
    .join("");

  return (
    <div className="characterPanel__portrait" aria-label="Character portrait">
      {dataUrl ? (
        <img src={dataUrl} alt={`${name || "Character"} portrait`} />
      ) : (
        <span className="characterPanel__portraitInitials" aria-hidden="true">
          {initials}
        </span>
      )}
    </div>
  );
}

/**
 * Compose a fantasy portrait prompt and run it through the image
 * provider. Throws on any provider error so the caller can surface
 * it; the cache layer's silent-fallback behaviour would be the wrong
 * default here (the player needs to know the call failed).
 */
async function generatePortrait(
  provider: ImageProvider,
  character: Pick<Character, "name" | "background" | "visual">,
): Promise<string> {
  const prompt = composePortraitPrompt(character);
  diag.info("image", `portrait request → provider for ${character.name}`, {
    provider: provider.id,
    promptLength: prompt.length,
  });
  const startedAt = performance.now();
  const result = await provider.generate({
    prompt,
    width: 512,
    height: 512,
  });
  diag.info("image", `portrait response (${Math.round(performance.now() - startedAt)}ms)`, {
    bytes: result.bytes.byteLength,
    mime: result.mime,
  });
  return bytesToDataUrl(result.bytes, result.mime);
}

function composePortraitPrompt(
  character: Pick<Character, "name" | "background" | "visual">,
): string {
  const parts: string[] = [];
  parts.push(
    "Head-and-shoulders portrait of a fantasy RPG character, centered, neutral painterly background, soft directional light.",
  );
  if (character.visual.trim()) {
    parts.push(`Appearance: ${character.visual.trim()}.`);
  }
  if (character.background.trim()) {
    // Pull in background as flavor context — the model can decide
    // which details actually surface visually (a smith's apron, a
    // sailor's tan) without us micromanaging.
    parts.push(`Context: ${character.background.trim()}.`);
  }
  parts.push(
    "Painterly oil-style, evocative but not photorealistic. No text, no borders, no UI elements.",
  );
  return parts.join(" ");
}

function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  // btoa() chokes on non-Latin-1 input; PNG bytes are binary so we
  // convert via String.fromCharCode chunks to stay below the call
  // stack limit on large buffers.
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode(...slice);
  }
  const base64 = btoa(binary);
  return `data:${mime};base64,${base64}`;
}

// Re-export for App.tsx convenience.
export type { Character } from "../state/store";
