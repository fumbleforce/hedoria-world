# 01 — Overview & Core Loop

## The premise

You are a streamer in a one-room studio apartment. The game alternates between two
states:

- **Offline** — between streams. You sleep (advancing the day and paying rent),
  cook, nap, shop for gear, answer the door, etc. Lifestyle actions adjust your
  stats but earn no money or followers.
- **Live** — you're streaming. Actions are performed for an audience, chat reacts,
  satisfied viewers tip and follow, and random events / story beats can fire.

Time is tracked on an in-world clock (minutes since midnight). A stream runs from
**8:00 pm** to at most **2:00 am**; it also ends if energy hits 0 or you stop it.
Sleeping resets to the next evening.

## The beat (turn) loop

Every player action — and the **Continue** button — runs the same pipeline,
orchestrated by `GameController` (`src/game/controller.ts`):

```
evaluate → resolve → narrate + chat react → advance time → afterBeat housekeeping
```

1. **Evaluate** — the action text becomes an `ActionVerdict` (plausible? how
   intense? which audience segments like/dislike it? what stat pressure?). Done by
   the LLM evaluator, or a local keyword engine offline. (See [05](./05-llm-stack.md).)
2. **Resolve** — pure code turns the verdict into metric changes, segment
   satisfaction shifts, tips, and followers. (See [02](./02-game-loop-and-economy.md).)
3. **Narrate + chat** — the LLM writes a short spoken line for the streamer plus a
   narrator beat, then a chat burst reacts. Offline, this is canned/local.
4. **Advance time** — the clock moves by an amount derived from the action's
   intensity (or a fixed cost for coded actions).
5. **`afterBeat`** (live only) — housekeeping: maybe end the stream, recompute who's
   in the room (presence), refresh the rolling "stream memory" summary, check goals,
   advance any stalker, then roll for a random event (28% chance).

Some actions are **coded "token" actions** (sleep, cook, nap, order food, change
outfit, toggle live…) that bypass the evaluator and apply fixed effects directly.
See [02 — Zones & token actions](./02-game-loop-and-economy.md#zones--token-actions).

## Glossary

| Term | Meaning |
|------|---------|
| **Beat / turn** | One action (or Continue) and its full resolution pipeline. |
| **Metrics** | Persistent stats: cash, followers, subscribers, hype, energy, comfort, hunger, bladder, hygiene, horny (No Limits), day, peak viewers. |
| **Session** | Transient per-stream tallies (round count, earnings, new followers, peak this stream). Not persisted. |
| **Audience segment** | One of 7 economic buckets (hype, lonely, simps, trolls, cozy, whales, stalkers), each with a `population` and `satisfaction`. Drives tips/followers/comfort. |
| **Named character / regular** | A procedurally generated viewer with a handle, archetype, affinity, and memory. Appears in chat and the Regulars gallery; can be DM'd. |
| **DM effect** | A structured consequence the **DM director** extracts from a private chat (tip, gift, image, name reveal, request, affinity/threat/relationship shift, or a real-world meetup). |
| **Visit / guest scene** | A DM-arranged meetup that fires as an offline doorstep event; letting the visitor in opens a looping, LLM-judged in-person scene. |
| **Archetype** | A template (20 of them) that seeds a named character and maps to a segment. |
| **Affinity** | 0–100 relationship score with a named character; thresholds unlock milestones. |
| **Threat** | 0–3 stalker escalation level on a named character. |
| **Presence** | The system that decides who is online each beat and the segment populations. |
| **Verdict** | The structured classification of an action (`ActionVerdict`). |
| **Intensity** | 1–5 scale of how bold/edgy an action is; drives time cost, spawn bias, and content gating. |
| **Content tier** | The escalation ceiling: wholesome / cheeky / risqué / unhinged / custom. |
| **Arc** | A multi-day story chain (sponsorship, viral, stalker-legal). |
| **Goal** | A soft one-time objective with a reward (e.g. 100 followers). |
| **Token action** | A `__name__` prompt handled directly by the controller, bypassing the evaluator. |
| **Backend** | Which LLM provider serves text: `mock`, `gemini`, or `openrouter`. |
| **Stream brand** | Public channel identity (`brand` in store): `@handle`, description, community rules, default niche, optional logo, frame accent. Chat and the live overlay use `@handle` only; `settings.streamerName` stays private for narrator/evaluator/DMs. |
| **Handle** | Public stream username (`brand.handle`). Chat LLM knows the streamer only as `@handle`. |

## Source file map

### `src/game/` — rules and orchestration (pure-ish, no React)
| File | Responsibility |
|------|----------------|
| `controller.ts` | The orchestrator. Beat loop, go live / end / sleep, economy, DMs, image gen, event/arc/goal wiring. (~2k lines.) |
| `resolver.ts` | Pure math: verdict → metric deltas, segment satisfaction, tips, followers, `totalViewers`. |
| `evaluator.ts` | Action → `ActionVerdict` (LLM + local fallback, self-consistency). |
| `actions.ts` | `PlayerAction`, `ActionOption`, `ActionVerdict`, the closed tag set. |
| `studio.ts` | Zones (5×5 grid), per-zone menus, token actions. |
| `segments.ts` | The 7 audience segments and their tuning. |
| `archetypes.ts` | The 20 viewer archetypes. |
| `personas.ts` | Mock chat line banks (`LINES`). |
| `characters.ts` | `CharacterSheet`, handle/name generation, relationship levels, spawn rolls. |
| `relationships.ts` | Affinity milestones, name reveals, the stalker escalation logic, word-of-mouth. |
| `dmDirector.ts` | Reads a DM thread → structured `DmEffect`s (tip/gift/image/reveal/request/affinity/threat/relationship/meetup); LLM + keyword fallback. |
| `requestJudge.ts` | Batched LLM judge for viewer-request fulfillment (`Check completed`); mock keyword overlap fallback. |
| `presence.ts` | Who's online each beat; derives segment populations. |
| `chatEngine.ts` | Chat burst generation (LLM + mock), parsing, cross-talk dynamics. |
| `events.ts` | The 12 event triggers, weighting, cooldown-aware rolling. |
| `arcs.ts` | The 4 multi-day story arcs (sponsorship, viral, stalker-legal, relationship) and their stages. |
| `goals.ts` | The 7 soft goals and their rewards. |
| `calendar.ts` | In-world date math and seasonal occasions. |
| `activities.ts` | Activity catalogue, category labels/order (`ACTIVITY_CATEGORY_*`). |
| `talents.ts` | Onboarding talent presets (singer, guitarist, …), quick actions, synergy segments. |
| `shop.ts` | Upgrades, category labels/order (`UPGRADE_*`), `isDecoration`, `decorationUpgrades`. |
| `time.ts` | Clock constants and time-cost table. |
| `content.ts` | Content tiers (`CONTENT_TIERS`), steering text, intensity helpers. |
| `settingsTabs.ts` | Settings modal tab ids + labels (`SETTINGS_TABS`). |
| `gender.ts` | Gender preset options (`GENDER_OPTIONS`, `genderMode`). |
| `liveActions.ts` | Live-stream quick actions (`LIVE_ACTIONS`). |
| `prompts.ts` | Story prompt templates and overrides. |
| `brand.ts` | Stream brand defaults, handle normalization, frame accent presets. |
| `types.ts` | Shared domain types (Metrics, Settings, GameEvent, StoryArc, …). |

### `src/llm/` — model integration
`types.ts`, `adapter.ts`, `providers.ts`, `geminiProvider.ts`,
`openRouterTextProvider.ts`, `mockProvider.ts`, `schema.ts`, `json.ts`, `stats.ts`,
`imageProvider.ts`, `imagePresets.ts`. (See [05](./05-llm-stack.md) and [06](./06-images-and-presentation.md).)

### `src/state/` — store
`store.ts` — the Zustand store, all state and actions, and the persist config.

### `src/persist/` — saving
`saves.ts` (slots), `imageStore.ts` (IndexedDB media, `IMAGE_KIND_*` gallery labels), `useStoredImage.ts` (hook).

### `src/render/` & `src/ui/` — presentation
`render/StudioRoom.tsx`, shared widgets (`GenderPicker.tsx`), plus panels/modals in [08 — UI map](./08-ui-map.md).

### Entry & infra
`src/boot.ts` (boot sequence), `src/main.tsx`, `src/diag/log.ts` (diagnostics),
`src/rng/rng.ts` (random helpers), `vite.config.ts` (dev proxy + log sinks).
