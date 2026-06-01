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
ShopPanel · InventoryPanel · SettingsPanel · EventModal · GoalsPanel · CalendarPanel · RequestsPanel · JobPanel
Full-page: Onboarding (first run, `!onboarded`) · WorkScreen (`workSession`, at work)
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
| **MetricsHud** | `ui/MetricsHud.tsx` | header | Brand, `@handle`, active save name, day + in-world date, live clock; cash/followers/subs/viewers; hype/energy/comfort/hunger/bladder/hygiene bars (+ horny when No Limits). |
| **StudioRoom** | `render/StudioRoom.tsx` | left (top) | Interactive room (zone hotspots + avatar) and the "Visualize here" button. See [06](./06-images-and-presentation.md). |
| **ChangeLogPanel** | `ui/ChangeLogPanel.tsx` | left (below map) | Scrollable, newest-first **activity log** of every metric/affinity/alert change (signed delta, tone color, and the "why" when known). Fed from `store.changeLog`, the structured sibling of the floating bubbles. |
| **StatsPanel** | `ui/StatsPanel.tsx` | left (below activity) | Compact **Channel**, **Live**, **Setup** (niche, outfit vibe from equipped clothes, freshness, skills). When employed, adds **Day job** (role, pay, shift, today status, strikes). Needs meters are in the HUD; **Hype** is in the chat header while live. With `settings.devMode`, adds **Dev** (viewer drivers, passive followers/beat, sub fraction/beat, gear). |
| **VisualizationPanel** | `ui/VisualizationPanel.tsx` | center top | The latest generated image (`lastImageId`); click → gallery. |
| **NarratorPanel** | `ui/NarratorPanel.tsx` | center bottom | The story feed (dm / action / outcome / quote / image entries). **Visualize scene** appears offline only (while live, use StreamView **Refresh feed**). |
| **ChatPanel** | `ui/ChatPanel.tsx` | right top | Live chat log; clicking a known user's handle opens their CharacterModal. Streamer's spoken lines do **not** appear here (they go to the narrator). |
| **CharacterGallery** | `ui/CharacterGallery.tsx` | right bottom | Audience-segment bars (when live) + the Regulars list. Each card shows the real name once known with the handle as a muted `@handle` secondary. Click → CharacterModal. |
| **ActionBar** | `ui/ActionBar.tsx` | footer | Freeform input + Act + Continue. Live: Actions dropdown, **Activity** 🎬 (start only when idle), Goals, **Requests** 📋 (badge = open count), Inventory, Character, Gallery, Settings, End. When an activity is active, a **🎬 Activity — …** banner above the input shows the segment label + **stop** (no duplicate chip in the action row). Shows **🎥 Off camera** when live but not on the active angle. Offline: **Job** 💼, Inventory, Goals, **Requests**, Character, Gallery, Settings (Go live from **desk zone** with stream-type picker; sleep → **bed**; work / job board → **door**). **During a visit:** a "🏠 In person" banner, Say/Do + Continue (guest leads), 📸 Visualize, Inventory, 🚪 See them out. **During an event scene:** a "⚡ In the moment" banner + stakes, Say/Do + Continue, 📸 Visualize, ✓ See it through. |

## Modals (overlay)

| Component | File | Opened by | Shows / does |
|-----------|------|-----------|--------------|
| **ActionMenuModal** | `ui/ActionMenuModal.tsx` | clicking a zone | The zone's contextual actions + a freeform box (when the zone allows it). At the **desk** while offline: **stream-type** dropdown beside **● Go live**. |
| **CharacterModal** | `ui/CharacterModal.tsx` | clicking a chatter/regular | The character sheet (name + handle, relationship, archetype, memory), the DM thread, and "generate portrait". DM lines render by `kind`: plain text, inline **image**, 💸/🎁 **gift**, or italic **system** (requests — shows status/reward chip + Dismiss when open). |
| **ActivityPicker** | `ui/ActivityPicker.tsx` | "Activity" 🎬 (live) | Pick a catalogue activity (grouped by category, tier-gated, shop-locked games) or type a custom activity. |
| **ShopPanel** | `ui/ShopPanel.tsx` | door → Shop | **Cameras**, **Clothing** (style + slot filters; gender is filter-only), Game Library, gear/furniture/apartment upgrades. Clothing: underwear gated to **Risqué+**; explicit pieces to **No Limits**. **Décor** cards show preview + **Visualize** when an image backend is set. |
| **SettingsPanel** | `ui/SettingsPanel.tsx` | "Settings" / 🎭 / 🖼 | 7 tabs (see below). |
| **EventModal** | `ui/EventModal.tsx` | a pending event | The event text + discrete choices, plus a freeform response box when `allowFreeform`. |
| **GoalsPanel** | `ui/GoalsPanel.tsx` | "Goals" 🎯 | Soft goals with progress bars + active story arcs ("threads") with their next day. |
| **RequestsPanel** | `ui/RequestsPanel.tsx` | "Requests" 📋 (ActionBar; badge when open) | All viewer content requests (Open / Fulfilled / Dismissed). **Check completed** runs the batched fulfillment judge; per-row **Dismiss** on open items. Click handle → CharacterModal. |
| **JobPanel** | `ui/JobPanel.tsx` | "Job" 💼 (ActionBar offline) or door → Job board | Current-job card (shift window, today's status, strikes, **Clock in** / Quit). **Job board** preset cards + custom job creator. Applying takes a random 45–300 min and **replaces** the current job, behind a "quit & apply" confirmation. Disabled while live. |
| **WorkScreen** | `ui/WorkScreen.tsx` | clocking in (`goToWork`) | Full-page "at work" overlay: generated workplace image (rendered once per job) + LLM/offline shift flavor + **Head home** (applies pay/time/costs via `leaveWork`). Smooth fade/rise in & out; resumes after reload via `store.workSession`. |

> The DM **guest visit** and **Event Director scenes** have no modal — they play out inline. The `StudioRoom` draws the
> guest by the couch (visits only), the `ActionBar` shows a "🏠 In person" or "⚡ In the moment" banner + meeting/scene controls
> (Say/Do, Continue, 📸 Visualize, 🚪 See them out / ✓ See it through), and
> beats stream into the `NarratorPanel`. Event consequences use the feedback/ChangeLog layer (see below). See [03](./03-social-systems.md)/[04](./04-events-arcs-goals.md).

## Onboarding (first-run setup)

`ui/Onboarding.tsx` — a **forced full-page wizard** (`<div class="onboard">`, `z-index: 45`)
rendered by `App` whenever `!store.onboarded`. It sits **below** the Settings modal
(`z-index: 50`) so its "⚙ Advanced — edit prompts" button can `openSettings("prompts")`
to layer the real prompt editors on top. Six steps with free Back/Next navigation
(completed steps in the header rail are clickable):

| Step | Sets | Notes |
|------|------|-------|
| 1 Intensity | `settings.contentTier`, `settings.difficulty` | Content tier from `CONTENT_TIERS_ONBOARDING` (wholesome / cheeky / risqué only; No Limits & Custom are Settings-only). Difficulty from `DIFFICULTY_LEVELS` in `game/balance.ts` (Easy / Normal / Hard). |
| 2 Art style | `settings.imageStylePreset` (clears per-field prompt overrides) | Same preset grid + on-demand previews as Settings → Prompts. |
| 3 Character | `streamerName` (private), `gender`, `streamerPersona`, **`talent`**, `character.face/bodyDescription` | Fixed presets (`game/characterPresets.ts`) grant starter wardrobe by preset vibe + gender; optional **Generate portrait + body**. |
| 4 Brand | `brand` (`handle`, `description`, `rules`, `defaultNiche`, `logoId`, `frameAccent`) | Public `@handle` for chat/stream overlay; optional logo gen. |
| 5 Day job | `job` | **No job**, a `JOB_PRESETS` card, or a custom title/wage/shift (`game/jobs.ts`). |
| 6 Room | `roomImage`, `zoneCells` | Optional **Generate room** / **Use default art**. |

Every step has a working default, so the flow completes **without an API key** —
image generation is offered but never required. "Start streaming" on the last step runs
`controller.finishOnboarding` (starter kit → opening beat → optional scene image), then
sets `onboarded = true` (persisted; see [07](./07-persistence.md)). Existing saves skip the
wizard via the `hasProgress` migration in `merge`.

### SettingsPanel tabs
| Tab | Contents |
|-----|----------|
| general | UI theme (default **Broadcast Deck** — solid hardware modules; plus the flat web themes Limelight/Ocean/Ember), content tier, **difficulty** (Easy/Normal/Hard), custom steering, text/image models, tiered routing, self-consistency, stream DMs, log level, streamer birthday. |
| prompts | Story prompt editor; the image **style preset grid with previews**; six collapsible image-prompt override editors. |
| room | Square **room map** editor with draggable zones (`zoneCells`); generate / regenerate / clear room art. |
| character | Character name (private), persona, gender, appearance description; portrait/body previews; generate. |
| brand | `@handle`, default niche, channel description, community rules, frame accent swatches, optional logo generate/regen/clear. **Apply as next stream** copies `defaultNiche` → `streamNicheDraft`. |
| gallery | The full IndexedDB image library by kind (includes **Channel logo**); regenerate / set active / delete / lightbox. |
| saves | Slot list; new / load / rename / delete (delete also purges that slot's images). |
| dev | Show backend/derived stats toggle (`settings.devMode`); spawn-viewer cheats. |
| llm | Session LLM telemetry (resets on reload). |

## Floating bits

- **toast** — transient status messages (bottom).
- **backendChip** — bottom-right; reactive selector (`textBackend` + `hasSession`).
  Shows `"openrouter"` only when `textBackend === "openrouter"` and the session is
  live (or Supabase isn't configured, i.e., dev mode). Otherwise `"offline engine"`.
  Flips instantly on login/logout without a reload.
- **LoginScreen** (`ui/LoginScreen.tsx`) — a **full-screen auth gate** rendered by
  `App` *instead of* the game whenever Supabase is configured and no user is signed
  in (`supabaseConfigured && !auth.user`). Shows the Limelight logo, a **"Sign in
  with Discord"** button, and a "Sign in to play" note. **There is no guest/offline
  bypass in the deployed build** — login is required to reach the game. While the
  initial session check is in flight it shows "Checking your session…". When Supabase
  is **not** configured (local dev), the gate is skipped entirely and the game boots
  straight into the offline engine, so dev/keyless play stays possible.
- **accountChip** (`☁`, in-game, bottom-right) — only reachable once past the gate;
  opens `AuthModal` for account management / sign-out.
- **AuthModal** — Discord-only by default; Google sign-in is behind a
  `const SHOW_GOOGLE = false` flag in `AuthModal.tsx` (code kept, button hidden). In
  the deployed build it's only used for the **signed-in** state (account/sign-out),
  since the LoginScreen owns the signed-out path.

## Image loading indicators (foreground vs background)

Image generation is a single mutex (`store.imageBusy: string | null` — the running
job's label) so only one job runs at a time. `store.imageBusyBackground: boolean`
splits it into two visual treatments, set together by `setImageBusy(label, background)`:

- **Foreground** (`imageBusy && !imageBusyBackground`) — the centerpiece the player
  is waiting on (kinds `scene` / `presence` / `portrait` / `work`, and gallery
  regenerate). Shows **two** indicators only: the pulsing `.viz__busy` label
  (top-right of the center panel) and a pulse on the center image itself
  (`.is-loading`). A "…this can take a while" toast also fires.
- **Background** (`imageBusyBackground`) — prerequisites/previews the player isn't
  directly watching: kinds `body` / `corner` / `backdrop` / `decoration` and style
  **previews**. `controller.genImage` derives this from `kind`. Shows only a single
  **subtle** quiet label (`.viz__busy--bg`, slow low-amplitude `subtlePulse`); no
  center-image pulse and **no toast**.

In both cases the trigger **buttons** (StudioRoom "Visualize here"/"Refresh feed",
StreamView refresh) are simply **disabled** while any
image job runs — they no longer blink or swap their label to the busy text, which is
what previously made loading feel like it lit up the whole UI at once. Room art is a
separate flag (`generatingRoom`); `resolving` / `dmBusy` drive their own narrator/DM
pending text and are unrelated to image jobs.

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

The stream-type picker lives in the **desk** `ActionMenuModal` go-live row
(`StreamNicheSelect`), and `@handle` mentions render as highlighted chips via
`ui/MentionText.tsx` in chat and the narrator feed.
