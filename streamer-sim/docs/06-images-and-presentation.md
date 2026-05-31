# 06 — Images & Presentation

Image generation, the style presets, the StudioRoom render, and UI theming.

Files: `src/llm/imageProvider.ts`, `imagePresets.ts`, `render/StudioRoom.tsx`,
`game/studio.ts`, `ui/themes.ts`, `src/index.css`, plus the image methods in
`controller.ts` and storage in `persist/imageStore.ts` (see [07](./07-persistence.md)).

## Image backends (`imageProvider.ts`)

Two backends, **no offline mock** — without a key, `resolveImageBackend` returns
`null` and image features are disabled.

Routing follows the **text backend** (there is no separate image-provider setting):
1. `textBackend === "gemini"` + key → Gemini image backend
2. `textBackend === "openrouter"` + proxy OK → OpenRouter image backend
3. else Gemini if key, else OpenRouter if OK, else `null`

Models: `settings.geminiImageModel` (`gemini-2.5-flash-image`) /
`settings.openRouterImageModel` (`google/gemini-2.5-flash-image`). Aspect ratio is
fixed 1:1.

## What gets generated (`controller.ts`)

| Method | Kind | Notes |
|--------|------|-------|
| `generateRoom()` | room | Sets the studio background; also added to the gallery. |
| `generateCharacter()` | portrait + body | Body is generated from the portrait (image-to-image) so the face/outfit match. Changing the character clears presence renders. |
| `generatePresence(zone)` | presence | The character placed in a specific zone; uses the body as a reference. |
| `generateScene()` | scene | A "stream cam" moment; pushed into the narrator feed. References: the streamer's body T-pose (likeness) + the **room art** (`roomImage`, for apartment layout/style) + — during an in-person **visit** — the guest's own full-body T-pose. The guest body is generated on demand by `ensureCharacterBody()` (using their portrait as a likeness reference when one exists), stored under a `cbody:<id>` KV key, and reused thereafter; it falls back to the portrait, then a text description. The prompt names each reference. |
| `generatePortrait(charId)` | (KV only) | A **viewer** avatar (hardcoded semi-real style); stored in a global KV key, not the gallery. |
| `generateStylePreview(presetId)` | preview (logged only) | A fixed common subject per style preset, for the Settings comparison grid; stored in a global KV key. |
| `regenerateImage(rec)` | varies | New id, same prompt/cache key. |

Presence/scene reuse the body T-pose as a reference image for consistency; scenes also
attach the room art (and, during a visit, the guest's own generated T-pose body) as
extra references. A single global `imageBusy` lock serializes scene generation; the
on-demand guest-body render uses the separate `portraitBusyId` lock (a second request
just toasts).

## Prompt templates & overrides (`imageProvider.ts`, `imagePresets.ts`)

Default templates: `DEFAULT_IMAGE_STYLE` (the universal `{{style}}` line),
`DEFAULT_ROOM_PROMPT`, `DEFAULT_PORTRAIT_PROMPT`, `DEFAULT_BODY_PROMPT`,
`DEFAULT_PRESENCE_PROMPT`, `DEFAULT_SCENE_PROMPT`, filled via `fillImagePrompt`
(`{{name}}`, `{{description}}`, `{{zone}}`, `{{narrative}}`, `{{upgrades}}`, …).

**Effective prompt resolution** (`effectiveImagePrompt(settings, field)`):
1. A non-empty per-field **override** in settings wins.
2. Else the active **preset's** field.
3. Default preset is `cozy-neon`.

`clearImagePromptOverrides()` clears the six override fields; `hasImagePromptOverrides`
detects any. So a player can pick a preset *and* override individual prompts on top.

## The 10 style presets (`imagePresets.ts`)

Each `ImagePromptSet` defines `imageStyle` + all five prompt variants
(room/portrait/body/presence/scene), plus a UI `label`, `blurb`, and two-color
`swatch`.

| id | Label | Vibe |
|----|-------|------|
| `cozy-neon` | Cozy Neon | Warm purple-pink streamer room (default/original) |
| `anime-cel` | Anime Cel | Bright cel-shaded visual-novel art |
| `graphic-novel` | Graphic Novel | Ink + watercolor, moody, limited palette |
| `semi-real` | Semi-Real | Natural lighting and skin tones |
| `retro-sim` | Retro Sim | Cheerful isometric life-sim dollhouse |
| `pixel-art` | Pixel Art | Crisp 16-bit pixel art |
| `storybook` | Storybook | Hand-painted gouache, Ghibli warmth |
| `synthwave` | Synthwave | 80s neon, chrome, sunset grid |
| `claymation` | Claymation | Tactile stop-motion clay |
| `papercraft` | Papercraft | Layered cut-paper diorama |

### In-game style previews
Settings → Prompts shows a thumbnail grid. The **game** generates a preview per
preset (fixed common subject so styles differ only by art style) via
`generateStylePreview`, cached in IndexedDB under
`style-preview:{presetId}:{hash(styleText)}` — **global** (shared across save slots),
not in the per-slot gallery, and auto-invalidated if a preset's style text changes.
Buttons: per-preset (re)generate, plus a bulk "Generate previews" / "Regenerate all".
Previews use each preset's **built-in** style, not the universal-style override.

## StudioRoom render (`render/StudioRoom.tsx`)

A 500×500 SVG. The 6 zones (`studio.ts`, 5×5 grid) are clickable hotspots; clicking
moves the avatar (CSS transform glide) and opens the zone menu.

- **Zone layout:** cells are mapped into an inset play area (`EDGE = 110`, computed
  `SPAN`) with `132×132` hotspot boxes, so the outer zones pull off the edges and sit
  over the furniture. (This was recently tuned up from small corner-hugging boxes.)
- **Background:** the generated `roomImage` (clipped) if present, else a hand-drawn
  `DefaultRoom` SVG with furniture at each zone.
- **Avatar:** the zone's presence image if generated, else the character portrait,
  else an emoji dot; ringed with `--accent` (live) or `--offline`.
- **Bar:** a hint line and a "📸 Visualize here / Redo here" button when image
  generation is available and a character exists.

> The default presence/room prompts say "her studio apartment" regardless of
> `settings.gender`. See [09](./09-expectation-vs-reality.md).

## UI themes (`ui/themes.ts`, `index.css`)

Three chrome themes (separate from image presets, which control LLM art direction):

| id | Label | Accents |
|----|-------|---------|
| `limelight` | Limelight | `#ff5d8f`, `#b079ff` (default) |
| `ocean` | Ocean | `#3bc9db`, `#228be6` |
| `ember` | Ember | `#ffa94d`, `#fab005` |

`applyTheme(theme)` sets `document.documentElement.dataset.theme`, which switches a
block of CSS variables (`--bg`, `--panel`, `--fg`, `--accent`, `--good`, `--danger`,
…). Applied on settings change, on rehydrate, and in `main.tsx` before/after
hydration.
