# Limelight — Issues

Concrete bugs, mismatches between intent and implementation, and dead code found
during the docs audit. Each entry is verified against source. For full context see
[`docs/09-expectation-vs-reality.md`](./docs/09-expectation-vs-reality.md); for the
forward-looking feature backlog see [`IMPROVEMENTS.md`](./IMPROVEMENTS.md).

Severity: 🔴 affects gameplay/feel · 🟡 confusing/misleading · ⚪ cosmetic/hygiene.

---

## Mechanics that don't do what they look like

- [ ] **🔴 Gear viewer multipliers are inert.** `shop.ts` computes `mult.viewer`
  (usb-mic ×1.1, 1080p-cam ×1.25, plant-wall ×1.05, loft ×1.3) but nothing reads it.
  Viewer counts come purely from `presence.ts` (followers + hype). Camera/gear
  upgrades have no effect on audience size.
  *Files:* `src/game/shop.ts:91`, `src/game/presence.ts`, `src/game/resolver.ts`.
  *Fix:* feed `mult.viewer` into `targetNamed`/anon-floor in `presence.ts`.

- [ ] **🔴 Mini-game `hypePerRound` / `energyPerRound` are ignored.** Only a +1
  appeal bump to `pleases` segments is applied while playing.
  *Files:* `src/game/games.ts`, `src/game/controller.ts`.
  *Fix:* apply the per-round hype/energy in the playing branch, or delete the fields.

- [ ] **🔴 Segments never shrink from being unhappy.** The resolver only moves
  satisfaction; population is 100% presence-driven. The `segments.ts` comment about
  unhappy segments "shrinking and leaving" is not implemented.
  *Files:* `src/game/resolver.ts`, `src/game/segments.ts`, `src/game/presence.ts`.

- [ ] **🔴 No recurring subscriber income.** `subscribers` is tracked and
  goal-rewarded, subs give a one-off cash bump in chat, but there's no monthly payout.
  *Files:* `src/game/controller.ts`, `src/game/goals.ts`.

- [ ] **🔴 Sponsorship "Push for more" gamble resolves at build time.** The
  `renewal×2` or `$0` payout is rolled with `Math.random()` when the event renders,
  not when the player clicks — outcome locked before choosing.
  *Files:* `src/game/arcs.ts`. *Fix:* move the RNG into resolution.

- [ ] **🟡 "Survive a month" goal has no solvency check.** Reward text says "without
  going broke" but it only checks `day ≥ 30`.
  *Files:* `src/game/goals.ts`.

- [ ] **🟡 Seasonal occasions are passive.** Holidays/birthday/anniversary apply a
  hype/mood/tips tailwind + a narrated line at go-live; no interactive themed event.
  *Files:* `src/game/calendar.ts`, `src/game/controller.ts`.

- [ ] **🟡 Arc beats only fire at day boundaries** (`goLive` / `sleep`), never
  mid-stream on the same day.
  *Files:* `src/game/controller.ts`.

- [ ] **🟡 Two divergent "intensity" scales for top tiers.**
  `tierIntensity(unhinged|custom)` = 4 but `controller.intensity(unhinged|custom)` = 3.
  *Files:* `src/game/content.ts`, `src/game/controller.ts`.

## Social / relationship seams

- [ ] **🔴 Actions don't change affinity directly.** Affinity only moves via chat
  messages (+0.6) and DMs (+3); a great on-stream moment doesn't warm a specific
  named viewer except indirectly through the chat burst.
  *Files:* `src/game/relationships.ts`, `src/game/controller.ts`.

- [ ] **🟡 Two competing name-reveal systems.** The milestone at affinity ≥35 (random
  from an 18-name pool) and `generateBackstory` on first sheet-open (LLM `name`) can
  conflict; neither is deterministic per character.
  *Files:* `src/game/relationships.ts`, `src/game/controller.ts`.

- [ ] **🟡 Stalker arc isn't the documented chat→DM→door→IRL ladder.** It's a daily
  threat counter (1→2→3, ≤1/day, gated only by `comfort < 75`) plus overlapping random
  `dm`/`door-knock` events; "fed" is only the comfort threshold, not the
  oversharing/ignored-creepy-chat the comment describes.
  *Files:* `src/game/relationships.ts`, `src/game/events.ts`.

- [ ] **🟡 Freeform event responses bypass special logic.** No stalker/sour-review
  handling, no arc starts (arcs start only from matching discrete choice *labels*), no
  power-cut early end.
  *Files:* `src/game/controller.ts`.

- [ ] **🟡 Everyday `dm` "Block and report" doesn't start the legal arc** — only
  `stalker-confront` block/report does.
  *Files:* `src/game/controller.ts`, `src/game/arcs.ts`.

## LLM stack

- [ ] **🟡 "DMs use the strong model" is false when tiering is on.** DM replies,
  performance spoken lines, and the stream-memory summary all use the `chat` kind, so
  with `tieredModels` on they go to the fast model — but the Settings help text and
  LLM-tab label say otherwise.
  *Files:* `src/game/controller.ts`, `src/ui/SettingsPanel.tsx`, `src/game/types.ts`
  (comment).

- [ ] **🟡 Telemetry model name is wrong for fast-tier calls.** Stats record
  `provider.id`, whose getter always reports the main model even on fast chat calls.
  The LLM tab also keeps only the last call per kind.
  *Files:* `src/llm/stats.ts`, `src/llm/geminiProvider.ts`,
  `src/llm/openRouterTextProvider.ts`.

- [ ] **🟡 Streaming only works for Gemini DMs.** `streamReplies` token-streams DM
  replies only on Gemini; the OpenRouter proxy forces `stream:false` (one chunk). Chat
  and narration never stream.
  *Files:* `src/llm/openRouterTextProvider.ts`, `src/llm/providers.ts`,
  `src/game/controller.ts`.

- [ ] **🟡 OpenRouter structured output is best-effort.** The evaluator schema is sent
  with `strict:false`; only Gemini enforces `responseSchema`.
  *Files:* `src/llm/openRouterTextProvider.ts`.

## Presentation / persistence

- [ ] **🟡 `roomImage` is stored in both places.** `partialize` persists the full data
  URL to localStorage (risking the ~5 MB cap) even though it also lives in IndexedDB.
  *Files:* `src/state/store.ts`, `src/boot.ts`.

- [ ] **🟡 Inactive save slots show no portrait thumbnail.** `getImage` filters by the
  active slot, so a non-active slot's `portraitId` can't load.
  *Files:* `src/persist/saves.ts`, `src/persist/imageStore.ts`,
  `src/ui/SettingsPanel.tsx`.

- [ ] **⚪ Viewer portraits & style previews are global across slots** (keyed only by
  char id / preset id).
  *Files:* `src/llm/imageProvider.ts`, `src/persist/imageStore.ts`.

- [ ] **⚪ Image backend can't be chosen independently** — it follows `textBackend`.
  *Files:* `src/llm/imageProvider.ts`.

- [ ] **⚪ Default image prompts assume "her"** regardless of `settings.gender`.
  *Files:* `src/llm/imageProvider.ts`, `src/llm/imagePresets.ts`.

- [ ] **⚪ `backendChip` can go stale** — reads the backend once at render without
  subscribing.
  *Files:* `src/App.tsx`.

- [ ] **⚪ After reload you're always offline.** `session` isn't persisted (chat/story/
  clock/zone now restore). Intentional today; revisit if undesired.
  *Files:* `src/state/store.ts`.

## Dead / unused code

- [ ] **⚪ `eventChance(base, intensity)`** — exported, never called (live/offline
  rates are hardcoded 28% / 40%). `src/game/events.ts:316`.
- [ ] **⚪ `nightProgress(clock)`** — never used for event gating. `src/game/time.ts:35`.
- [ ] **⚪ `mult.viewer`** — computed, never read (see top issue). `src/game/shop.ts`.
- [ ] **⚪ `hypePerRound` / `energyPerRound`** — defined, never applied.
  `src/game/games.ts`.
- [ ] **⚪ `RelationshipType`** — type defined, never used. `src/game/characters.ts`.
- [ ] **⚪ `HANDLES`, `MOD_HANDLES`** — dead; anon handles are procedural.
  `src/game/personas.ts`.
- [ ] **⚪ `deletePortrait(charId)`** — exported, never called.
  `src/persist/imageStore.ts:286`.
- [ ] **⚪ `GameEvent.stakes`** — read by the freeform judge, never set by builders.
  `src/game/types.ts`.
- [ ] **⚪ Unused re-exports `steeringForTier`, `fillPrompt`** in
  `src/game/evaluator.ts`.
- [ ] **⚪ `__open_shop__` token** — handled but not present in any zone menu.
  `src/game/studio.ts`, `src/game/controller.ts`.
