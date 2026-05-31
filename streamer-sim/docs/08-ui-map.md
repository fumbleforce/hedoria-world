# 08 — UI Map

Files: `src/App.tsx`, `src/render/StudioRoom.tsx`, `src/ui/*`, `src/index.css`.

## Layout (`App.tsx`)

```
┌─────────────────────────────────────────────────────────┐
│ MetricsHud  (full-width header)                          │
├──────────────┬────────────────────┬─────────────────────┤
│ stage__left  │ stage__center      │ stage__right        │
│              │                    │                     │
│ StudioRoom   │ VisualizationPanel │ ChatPanel           │
│ ChangeLog    │ NarratorPanel      │ CharacterGallery    │
│ StatsPanel   │                    │                     │
├──────────────┴────────────────────┴─────────────────────┤
│ ActionBar  (footer)                                      │
└─────────────────────────────────────────────────────────┘

Overlays (modals): ActionMenuModal · CharacterModal · ActivityPicker ·
ShopPanel · InventoryPanel · SettingsPanel · EventModal · GoalsPanel · CalendarPanel · RequestsPanel
Floating: toast (bottom) · backendChip (bottom-right)
```

The three columns use a grid `minmax(260px,0.95fr) | minmax(0,1.15fr) |
minmax(280px,340px)`, capped at 1340px. Until `boot()` resolves, a
`"◉ Limelight — booting…"` screen shows.

> The layout is a fixed three-column desktop grid; there's no responsive/stacked
> mobile mode yet (it's on the backlog).

## Panels (persistent)

| Component | File | Where | Shows / does |
|-----------|------|-------|--------------|
| **MetricsHud** | `ui/MetricsHud.tsx` | header | Brand, streamer name, active save name, day + in-world date, live clock; cash/followers/subs/viewers; hype/energy/comfort/hunger/bladder/hygiene bars (+ horny when No Limits). |
| **StudioRoom** | `render/StudioRoom.tsx` | left (top) | Interactive room (zone hotspots + avatar) and the "Visualize here" button. See [06](./06-images-and-presentation.md). |
| **ChangeLogPanel** | `ui/ChangeLogPanel.tsx` | left (below map) | Scrollable, newest-first **activity log** of every metric/affinity/alert change (signed delta, tone color, and the "why" when known). Fed from `store.changeLog`, the structured sibling of the floating bubbles. |
| **StatsPanel** | `ui/StatsPanel.tsx` | left (below activity) | Compact **Channel**, **Live**, **Setup** (niche, outfit, freshness, skills). Needs meters are in the HUD; **Hype** is in the chat header while live. With `settings.devMode`, adds **Dev** (viewer drivers, passive followers/beat, sub fraction/beat, gear). |
| **VisualizationPanel** | `ui/VisualizationPanel.tsx` | center top | The latest generated image (`lastImageId`); click → gallery. |
| **NarratorPanel** | `ui/NarratorPanel.tsx` | center bottom | The story feed (dm / action / outcome / quote / image entries) and a "Visualize scene" button. |
| **ChatPanel** | `ui/ChatPanel.tsx` | right top | Live chat log; clicking a known user's handle opens their CharacterModal. Streamer's spoken lines do **not** appear here (they go to the narrator). |
| **CharacterGallery** | `ui/CharacterGallery.tsx` | right bottom | Audience-segment bars (when live) + the Regulars list. Each card shows the real name once known with the handle as a muted `@handle` secondary. Click → CharacterModal. |
| **ActionBar** | `ui/ActionBar.tsx` | footer | Freeform input + Act + Continue. Live: Actions dropdown, Game, Goals, **Requests** 📋 (badge = open count), Inventory, Character, Gallery, Settings, End. Shows **🎥 Off camera** when live but not on the active angle. Offline: niche picker, Inventory, Goals, **Requests**, Character, Gallery, Settings (Go live from **current zone** if a camera covers it; sleep → **bed**; shop → **door**). **During a visit:** a "🏠 In person" banner, Say/Do + Continue (guest leads), 📸 Visualize, Inventory, 🚪 See them out. **During an event scene:** a "⚡ In the moment" banner + stakes, Say/Do + Continue, 📸 Visualize, ✓ See it through. |

## Modals (overlay)

| Component | File | Opened by | Shows / does |
|-----------|------|-----------|--------------|
| **ActionMenuModal** | `ui/ActionMenuModal.tsx` | clicking a zone | The zone's contextual actions + a freeform box (when the zone allows it). |
| **CharacterModal** | `ui/CharacterModal.tsx` | clicking a chatter/regular | The character sheet (name + handle, relationship, archetype, memory), the DM thread, and "generate portrait". DM lines render by `kind`: plain text, inline **image**, 💸/🎁 **gift**, or italic **system** (requests — shows status/reward chip + Dismiss when open). |
| **ActivityPicker** | `ui/ActivityPicker.tsx` | "Activity" 🎬 (live) | Pick a catalogue activity (grouped by category, tier-gated, shop-locked games) or type a custom activity. |
| **ShopPanel** | `ui/ShopPanel.tsx` | door → Shop | **Cameras**, **Clothing**, Game Library, gear/furniture/apartment upgrades. |
| **SettingsPanel** | `ui/SettingsPanel.tsx` | "Settings" / 🎭 / 🖼 | 7 tabs (see below). |
| **EventModal** | `ui/EventModal.tsx` | a pending event | The event text + discrete choices, plus a freeform response box when `allowFreeform`. |
| **GoalsPanel** | `ui/GoalsPanel.tsx` | "Goals" 🎯 | Soft goals with progress bars + active story arcs ("threads") with their next day. |
| **RequestsPanel** | `ui/RequestsPanel.tsx` | "Requests" 📋 (ActionBar; badge when open) | All viewer content requests (Open / Fulfilled / Dismissed). **Check completed** runs the batched fulfillment judge; per-row **Dismiss** on open items. Click handle → CharacterModal. |

> The DM **guest visit** and **Event Director scenes** have no modal — they play out inline. The `StudioRoom` draws the
> guest by the couch (visits only), the `ActionBar` shows a "🏠 In person" or "⚡ In the moment" banner + meeting/scene controls
> (Say/Do, Continue, 📸 Visualize, 🚪 See them out / ✓ See it through), and
> beats stream into the `NarratorPanel`. Event consequences use the feedback/ChangeLog layer (see below). See [03](./03-social-systems.md)/[04](./04-events-arcs-goals.md).

### SettingsPanel tabs
| Tab | Contents |
|-----|----------|
| general | UI theme, content tier, custom steering, text/image models, tiered routing, self-consistency, stream DMs, log level, streamer birthday. |
| prompts | Story prompt editor; the image **style preset grid with previews**; six collapsible image-prompt override editors. |
| room | Room art preview; generate / regenerate / clear. |
| character | Name, persona, gender, appearance description; portrait/body previews; generate. |
| gallery | The full IndexedDB image library by kind; regenerate / set active / delete / lightbox. |
| saves | Slot list; new / load / rename / delete (delete also purges that slot's images). |
| dev | Show backend/derived stats toggle (`settings.devMode`); spawn-viewer cheats. |
| llm | Session LLM telemetry (resets on reload). |

## Floating bits

- **toast** — transient status messages (bottom).
- **backendChip** — bottom-right; shows `"offline engine"` when on Mock, else the
  backend name. It reads the setting once at render, so it can go stale if you change
  the backend without reloading.

## Feedback layer (where the +/− bubbles come from)

The §4 overhaul added a legibility layer so every state change explains itself.

- **Source of truth** — a transient (non-persisted) `feedback: FeedbackBubble[]` slice
  in `state/store.ts`. `patchMetrics` and `patchCharacter` **auto-diff** their changes
  into bubbles (coalescing repeated deltas), tagged with a tone and an optional
  **reason** string set via `setFeedbackContext`/`clearFeedbackContext` around the code
  that caused the change (so "+$12 — whale tip", "−4 comfort — pushed past the room").
- **Activity log** — the same three bubble sources (metric diff, affinity diff,
  `pushFeedback` alerts) also append a structured `ChangeLogEntry` to the
  (non-persisted) `changeLog` slice, rendered newest-first by `ChangeLogPanel` under
  the studio map. This is the durable, scrollable counterpart to the ~1.7 s bubbles.
- **Rendering** — `ui/FeedbackBubbles.tsx` exports `<FloatingFeedback>` (the float-up
  `+N/−N` chip) and the `useFeedbackJanitor` hook that expires bubbles (~1.5 s).
  - **HUD** (`MetricsHud.tsx`): chips float from the changed `Stat`
    (cash/followers/subs) and `Bar` (hype/energy/comfort/hunger/bladder/hygiene[/horny]); also hosts the
    **mastery chips** readout (showmanship/composure levels).
  - **Character cards** (`CharacterGallery.tsx` / `CharacterModal.tsx`): affinity
    `+N/−N` bubble on the avatar, plus a persistent warming/**cooling arrow** so neglect
    (decay) is legible at a glance.
- **"What changed" log** — reasoned feedback also writes a `logEvent` line (notable ones
  reach the story feed), giving the §8 "what changed" panel essentially for free.
- CSS keyframes (float-up + fade) live in `index.css` (`.fb-layer` / `.fb-bubble`);
  containers that host bubbles are `position: relative`.

The niche **schedule board** picker also lives in the offline `ActionBar`
(`NichePicker`), and `@handle` mentions render as highlighted chips via
`ui/MentionText.tsx` in chat and the narrator feed.
