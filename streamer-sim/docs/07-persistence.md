# 07 — Persistence & Boot

Files: `src/persist/saves.ts`, `imageStore.ts`, `useStoredImage.ts`,
`src/state/store.ts`, `src/boot.ts`.

## Policy

**Full-state persistence:** refresh, slot reload, and browser restart must restore
the **exact** gameplay state the player had — live session, activity, in-progress
scenes, pending events, UI-relevant flags, chat/story, clock, zone, roster, audience,
etc. See [`.cursor/rules/streamer-sim-persistence.mdc`](../../.cursor/rules/streamer-sim-persistence.mdc)
for agent/engineering rules when adding state.

The sections below describe **what the code does today**. Any field listed as "not
persisted" that affects player-visible or sim behavior is **policy debt** until moved
into `partialize` or restored in `boot` / `resumeLive()`.

## Three-tier model

- **localStorage** — the save-slot index, per-slot game state (small JSON), and slot
  metadata. Primary store; always used.
- **IndexedDB** (`limelight-media`, v2) — large image blobs (data URLs): room
  backgrounds, viewer portraits, style-preset previews, and the gallery.
- **Supabase** (`public.saves`) — optional cloud backup. Mirrors the Zustand persist
  blob (`state_json: jsonb`) one row per user+slot. Requires `VITE_SUPABASE_URL` /
  `VITE_SUPABASE_ANON_KEY` and an authenticated user. See `src/persist/cloudSave.ts`.

## Save slots (`saves.ts`)

| localStorage key | Purpose |
|------------------|---------|
| `limelight-saves` | The `SaveIndex` (`{ activeId, slots: SaveSlotMeta[] }`) |
| `limelight-slot:{uuid}` | One slot's Zustand persist blob |
| `limelight-save-v3` | Legacy single-save key, migrated once then deleted |

`SaveSlotMeta = { id, name, characterName, day, portraitId, createdAt, updatedAt }`.

- `createSlot` / `createAndActivateSlot(name, seedSettings?)` — a new slot; "new game"
  seeds only the current **settings** into the slot, so metrics/roster/chat start
  fresh from defaults. The seed is run through `freshGameSettings()` first, which
  carries over technical/LLM config (provider, models, prompts, theme, dev flags)
  but resets the character identity (`streamerName`, `streamerPersona`, `gender`,
  `streamerBirthday`) to defaults — otherwise the new game would clone the previous
  save's streamer. **`settings.difficulty`** carries over like theme; starting
  cash/followers are seeded from `startingMetrics(difficulty)` on first boot (and again
  when onboarding finishes on a still-fresh save via `applyStartingMetricsIfFresh()`).
- `setActiveSlot(id)` updates the index only; the Saves tab triggers a full
  `window.location.reload()` to rebind.
- `updateActiveMeta` syncs the slot's `characterName/day/portraitId` (called on day
  change, rename, portrait change).
- `deleteSlot` is blocked when only one slot exists, and also deletes that slot's
  IndexedDB images.
- `migrateLegacy` upgrades a pre-slots `limelight-save-v3` save into a slot.

## What persists (Zustand `partialize` in `store.ts`)

Persist name is `limelight-save-v3` by default but is **retargeted at boot** to
`limelight-slot:{activeId}`. `skipHydration: true` (boot rehydrates explicitly).
`merge` deep-merges `settings` so new settings fields get defaults on old saves.

**Persisted:**
`onboarded` (first-run setup flag — see below), `metrics`, `session`, `activity` (while live), `audience`, `settings` (includes **`talent`**), **`brand`** (public `@handle`, channel description/rules, default niche, logo id, frame accent), **`streamNicheDraft`** (desk picker for the next go-live), `ownedUpgrades`, `ownedActivities`, **`starterKitGranted`**, **`decorationImages`** (upgrade id → image id), `promptOverrides`,
`cameras`, `activeCameraId`, `inventory`, `equippedClothing`,
`eventLog`, `recentEvents`, `arcs`, `completedGoals`, `roomImage`, `zoneCells` (draggable zone layout on the room map), `dmThreads`, `chat`,
`story`, `clock`, `zone`, `character` (ids only), `presenceImages` (ids), `lastImageId`,
`roster` (verbatim, **including** online flags), `pendingVisits`, `viewerRequests`, **`job`**
(day-job title, wage, shift window, strikes, last clock-in day/on-time flag), **`workSession`**
(active "at work" shift overlay — deferred pay/time/costs + generated image id & flavor, so a
mid-shift reload resumes the Work screen), and the active
`visitor` guest scene (so an in-progress visit survives a reload).

> `chat`, `story`, `clock`, and `zone` were **recently added** to fix history being
> wiped on reload. `chat` is capped at 140 messages, `story` at 200.
>
> `session` is persisted so a **live** stream survives a reload (the `isLive` flag plus
> the `round`/`earnings`/`newFollowers`/`peak` totals). **`activity`** is saved with
> it while live so an in-progress segment (game, ASMR, etc.) survives reload too.
> The **full live room** is now
> persisted too: the roster's `online` flags and the `audience` snapshot (segment
> populations + satisfaction). `currentViewers` rides along inside `metrics`. So a
> reload/load reproduces the **exact** room it was saved in — same cast online, same
> audience mix — rather than re-rolling who's watching. `boot.ts` calls
> `controller.resumeLive()` only to restore controller-internal counters; it does **not**
> touch presence and does **not** fabricate chat. Old saves without a stored `session`
> key keep the offline default (the persist `merge` only spreads keys present in the
> saved blob).

> **`onboarded`** gates the first-run setup flow (intensity + difficulty → art style → character → brand → skills →
> room; see [08](./08-ui-map.md)). A brand-new slot (created by "New game") persists
> only its seed settings, so on first load the `merge` computes `onboarded = false` and
> the wizard is forced. Existing saves are migrated to `true` by a `hasProgress`
> heuristic in `merge` — true when the save already has a generated character
> (`character.portraitId`/`bodyId`), a `roomImage`, `day > 1`, any `story`, or is mid-
> stream — so returning players are never interrupted. The wizard sets `onboarded = true`
> on finish. **`brand`** is migrated on old saves: `handle = suggestHandle(settings.streamerName)`,
> `defaultNiche` from `streamNicheDraft` or legacy `settings.niche`, other fields default empty.
> `finishOnboarding` sets `streamNicheDraft = brand.defaultNiche`.

**Not persisted (reset/rebuilt on reload):**
`booted`, `pendingEvent`, `resolving`, all UI modal flags, `toast`, busy
flags, and the in-memory `imageCache` (rebuilt from IndexedDB). The
ambient-chat loop isn't a state field — it isn't restarted on load and resumes on the
player's next action.

## IndexedDB media (`imageStore.ts`)

Database `limelight-media` v2, two object stores:
- `kv` — string values by key.
- `images` — `StoredImage` records, indexed by `cacheKey`, `kind`, `createdAt`.

`StoredImage = { id, slotId, cacheKey, kind, label, prompt, dataUrl, characterName,
meta?, sourceImageId?, createdAt }`. `ImageKind = logo | room | portrait | body | presence |
scene | corner | backdrop | decoration | work`.

| KV key | Scope | Purpose |
|--------|-------|---------|
| `roomImage:{slotId}` | per slot | active room background |
| `portrait:{charId}` | **global** | viewer avatars |
| `style-preview:{presetId}:{hash}` | **global** | preset preview thumbnails |

**Cache keys:** `imageCacheKey(parts)` joins non-empty parts with `|`, lowercases,
and hashes with `cyrb53`. Identical inputs dedupe to the same stored image. `putImage`
stamps the active `slotId`; `getImage`/`getByCacheKey`/`listImages` filter to the
active slot. `useStoredImage(id)` reads the in-memory cache or lazy-loads from
IndexedDB.

## Cloud save layer (`src/persist/cloudSave.ts`)

Thin Supabase wrappers. All functions are no-ops when `supabaseConfigured` is false.

| Function | Description |
|----------|-------------|
| `pushSave(user, slotMeta, stateJson)` | Upsert a slot's Zustand blob to `public.saves` |
| `pullSave(user, slotId)` | Fetch `state_json` for a slot (returns `null` if absent) |
| `listCloudSaves(user)` | List all slots for a user, sorted by `updated_at` |

**Auth state** is managed by `src/auth/useAuth.ts` (React hook) and rendered via
`src/ui/AuthModal.tsx` (cloud ☁ button in the bottom-right corner). Supports Google
and Discord OAuth via Supabase Auth. Subscription tier (`free | pro`) is fetched from
`public.profiles` on login.

**Payments** — `src/lib/lemonSqueezy.ts` opens the LemonSqueezy checkout with the
Supabase `user_id` embedded as `checkout[custom][user_id]`. The edge function
`supabase/functions/lemon-webhook` verifies the HMAC-SHA256 signature and updates
`profiles.subscription_status` / `subscription_tier` on subscription events. On a
tier change it also `PATCH`es the user's OpenRouter runtime-key spend cap.

**Per-user OpenRouter keys** (migration `003`) — `public.user_openrouter_keys`,
one row per user (`user_id` PK, `key_hash`, `encrypted_key`). RLS is on with **no
policies**, so only the service-role edge functions can read/write it; end-user
JWTs are denied entirely. The `openrouter-proxy` function mints a per-user runtime
key on first LLM use and stores it here (tagged `enc:v1:` or `plain:` — see
`docs/05-llm-stack.md`). Nothing in this table is ever sent to the client.

## Boot sequence (`boot.ts`)

1. `migrateLegacy()` → resolve the active slot.
2. Point the persist layer at `limelight-slot:{id}` and `rehydrate()`.
3. Configure diagnostics from `consoleLevel`.
4. Normalize the roster (back-fill fields for old saves) **without** touching presence —
   online flags are restored as saved.
5. Load the room image from IndexedDB (migrating any legacy key).
6. Read `VITE_GEMINI_API_KEY`, probe `/__openrouter/status`.
7. **Reconcile the backend** (`effectiveBackend`): a stale/default `mock` upgrades to a
   real provider when keys exist (Gemini preferred); an unavailable explicit choice
   degrades. Keeps the Settings dropdown/HUD chip honest.
8. Build the text provider, image backend, and `GameController`.
9. `hydrateImageCache()` (async) pulls portrait/body/presence/last-image blobs into
   memory.
10. If the persisted `session.isLive`, call `controller.resumeLive()` — restore
    controller-internal counters only. Presence (online flags) and `audience` are already
    persisted, so the saved room is reproduced exactly; no chat is fabricated and the
    ambient loop resumes on the player's next action.
11. `updateActiveMeta`, then `setBooted(true)`.

A `bootPromise` singleton ensures boot runs once.

## Persistence gotchas (see also [09](./09-expectation-vs-reality.md))

- **`roomImage` is double-stored** — the comment says blobs live only in IndexedDB,
  but `partialize` still includes the full `roomImage` data URL, so it also lands in
  localStorage (risking the ~5 MB cap). IndexedDB is authoritative on boot.
- **Save-card thumbnails for inactive slots** — `getImage` filters by the *active*
  slot, so an inactive slot's portrait thumbnail won't load.
- **Viewer portraits & style previews are global** — shared across slots/worlds for
  the same id.
- **`deletePortrait` is exported but never called.**
