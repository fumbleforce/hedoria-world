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

## Two-tier model

- **localStorage** — the save-slot index, per-slot game state (small JSON), and slot
  metadata.
- **IndexedDB** (`limelight-media`, v2) — large image blobs (data URLs): room
  backgrounds, viewer portraits, style-preset previews, and the gallery.

## Save slots (`saves.ts`)

| localStorage key | Purpose |
|------------------|---------|
| `limelight-saves` | The `SaveIndex` (`{ activeId, slots: SaveSlotMeta[] }`) |
| `limelight-slot:{uuid}` | One slot's Zustand persist blob |
| `limelight-save-v3` | Legacy single-save key, migrated once then deleted |

`SaveSlotMeta = { id, name, characterName, day, portraitId, createdAt, updatedAt }`.

- `createSlot` / `createAndActivateSlot(name, seedSettings?)` — a new slot; "new game"
  seeds only the current **settings** into the slot, so metrics/roster/chat start
  fresh from defaults.
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
`metrics`, `session`, `activity` (while live), `audience`, `settings`, `ownedUpgrades`, `ownedActivities`, `promptOverrides`,
`eventLog`, `recentEvents`, `arcs`, `completedGoals`, `roomImage`, `dmThreads`, `chat`,
`story`, `clock`, `zone`, `character` (ids only), `presenceImages` (ids), `lastImageId`,
`roster` (verbatim, **including** online flags), `pendingVisits`, and the active
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

**Not persisted (reset/rebuilt on reload):**
`booted`, `pendingEvent`, `resolving`, all UI modal flags, `toast`, busy
flags, and the in-memory `imageCache` / `stylePreviews` (rebuilt from IndexedDB). The
ambient-chat loop isn't a state field — it isn't restarted on load and resumes on the
player's next action.

## IndexedDB media (`imageStore.ts`)

Database `limelight-media` v2, two object stores:
- `kv` — string values by key.
- `images` — `StoredImage` records, indexed by `cacheKey`, `kind`, `createdAt`.

`StoredImage = { id, slotId, cacheKey, kind, label, prompt, dataUrl, characterName,
meta?, sourceImageId?, createdAt }`. `ImageKind = room | portrait | body | presence |
scene`.

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
