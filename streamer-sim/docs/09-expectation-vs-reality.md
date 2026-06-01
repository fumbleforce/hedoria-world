# 09 — Expectation vs Reality

The concentrated list of places where the game's **stated intent** (UI text,
comments, doc names, design backlog) doesn't match **what the code actually does** —
plus dead code and the biggest mechanical gaps. This is the "where the seams are" doc.

Severity legend: 🔴 affects gameplay/feel · 🟡 confusing/misleading · ⚪ cosmetic/hygiene.

---

## A. Mechanics that don't do what they look like

### ✅ A1 — Camera/viewer gear upgrades have no effect *(resolved §4 overhaul)*
`presenceTick` now scales the named-cast target **and** the anonymous floor by
`mult.viewer`, so camera/mic/plant/loft upgrades grow the audience. Gear also gained
two new appeal axes (`productionQuality`, `segmentAppeal`) wired into baseline appeal
and spawn bias. *(historical note below.)* `shop.ts` computes `mult.viewer` (usb-mic
×1.1, 1080p-cam ×1.25, plant-wall ×1.05,
loft ×1.3), but **nothing read `mult.viewer`**. Viewer counts came purely from
`presence.ts` (a function of followers + hype). So the entire "viewer multiplier"
half of the shop was inert; only `mult.hype`, `mult.income`, `mult.comfortPerDay`, and
`mult.rentPerDay` actually do anything. *(`shop.ts`, `resolver.ts`, `presence.ts`)*

### ✅ A2 — Activity `hypePerRound` / `energyPerRound` *(resolved §5 activities)*
Each catalogue activity defines per-round hype/energy; `applyActivityRoundCosts` in
`controller.ts` applies them on every live beat while `activity` is set (hype ×
`mult.hype`, energy drain direct). The +1 appeal bump to `pleases` segments remains.
*(`activities.ts`, `controller.ts`)*

### ✅ A3 — Segments never shrink from being unhappy *(resolved §4 overhaul)*
Population is still presence-driven, but **dissatisfied segments now leave faster**:
`presenceTick` adds a per-character leave boost `(55−sat)/55 × leaveOnDislikeBoost`,
so pushing content a room dislikes visibly empties it. The old gap: the resolver only
moved **satisfaction** — segment **population** was 100% presence-driven, so you
couldn't lose a crowd by displeasing them mid-stream. *(`presence.ts`, `resolver.ts`)*

### ✅ A4 — No recurring subscriber income *(resolved §4 overhaul)*
`payRecurringSubs` (called from `sleep`) now pays `subscribers × $3.5 × mult.income`
on a 30-day cadence through the income path, surfaced as a positive alert.
*(`controller.ts`, `balance.ts`)*

### 🔴 A5 — Sponsorship "Push for more" gamble is decided at build time
The renewal gamble's random payout (`renewal×2` or `0`) is rolled when the event is
*rendered* (`Math.random()` in `arcs.ts`), not when you click. The outcome is locked
before you choose. *(`arcs.ts`)*

### 🟡 A6 — "Survive a month" goal has no solvency check
The reward text says "without going broke," but the goal only checks `day ≥ 30`.
*(`goals.ts`)*

### ✅ A6c — Chat used the private character name *(resolved — stream brand)*
Live chat prompts and the stream overlay previously used `settings.streamerName` everywhere.
**Stream brand** (`brand.handle`) is now the public identity: chat LLM, HUD, and `StreamView`
show `@handle` only; narrator/evaluator/DMs keep the private character name.

### ✅ A6b — Raid chat promised viewers that never appeared *(resolved)*
The director `raid` effect posted `🎉 Raid! ~N viewers pour in!` and bumped channel
followers, but never touched live `currentViewers` — the anon floor was recalculated
each beat without a raid bonus, so the HUD stayed flat. Raids now accumulate
`session.viewerSurge`, folded into the anon floor until the stream ends.
*(`controller.ts`, `types.ts`)*

### 🟡 A7 — Seasonal occasions are passive
Holidays/birthday/anniversary apply a hype/comfort/tips tailwind + a narrated line at
go-live, but there's **no interactive themed event** (no Halloween costume choice, no
NYE countdown). *(`calendar.ts`, `controller.ts`)*

### 🟡 A8 — Arc beats only fire at day boundaries
Due arc stages surface at `goLive` / `sleep`, never mid-stream on the same day. A long
multi-day-feeling single session won't see an arc beat until the next boundary.
*(`controller.ts`)*

### 🟡 A9 — Two unrelated "intensity" scales for the top tiers
`tierIntensity(unhinged|custom)` = **4** (chat, stalker gate, local-eval cap), but
`controller.intensity(unhinged|custom)` = **3** (presence spawn bias). They diverge at
the top end. *(`content.ts`, `controller.ts`)*

---

## B. Social/relationship seams

### 🟡 B1 — Two competing name-reveal systems
A name can be revealed either by the **milestone** at affinity ≥35 (a random pick from
an 18-name pool) or by **`generateBackstory`** when you first open a sheet (an LLM
`name`). Whichever runs first wins; neither is deterministic per character, and the
backstory path can pre-empt the milestone's flavor beat. *(`relationships.ts`,
`controller.ts`)*

### ✅ B5 — (resolved) DM `request` effects were flavor-only
Previously the DM director could emit `request: …` system lines, but there was no
structured tracking, no fulfillment check, and `BALANCE.affinity.sources.request` was
never applied. Now `viewerRequests[]` persists open/fulfilled/dismissed state,
**RequestsPanel** + **Check completed** (`requestJudge.ts`) apply promised rewards
(affinity or cash + optional bonus), and affinity pays on fulfillment not creation.
*(`controller.ts`, `requestJudge.ts`, `store.ts`, `RequestsPanel.tsx`)*

### 🟡 B2 — Stalker arc isn't the documented chat→DM→door→IRL ladder
It's a daily **threat counter** (1→2→3, ≤1 step/day, gated only by `comfort < 75`)
plus *overlapping* random events: the `door-knock` event turns creepy at threat ≥1
**and intensity ≥2**, and the `dm` event turns creepy the same way but now arrives as a
**real DM** (no modal — see [04](./04-events-arcs-goals.md)). (The intensity ≥2 gate
matches the `creep`/`stalker` archetypes, which only spawn at risqué+, so creepy beats
can't surface below that tier.) There's no strict ordered state machine, and "fed" is
only the comfort threshold (not the oversharing/ignored-creepy-chat the comment
describes). *(`relationships.ts`, `events.ts`)*

### ✅ B3 — (resolved) Event Director replaces thin modal events
Hardcoded modal events and ambient `rollEvent` are retired. The Event Director authors
scenes/notices from state + signals; consequences use the capability vocabulary and
surface through the feedback layer. *(`eventDirector.ts`, `controller.ts`)*

### ✅ B4 — (resolved) The everyday `dm` event is now a real DM, not a modal
It no longer has canned "Block and report / Reply kindly" choices: it's delivered into
the sender's DM thread with a notification and answered conversationally, so the DM
director (not a fixed `effects` payload) owns the fallout. Stalker threat-3 is now a
`mustAddress` director signal (static fallback if LLM declines), not `stalker-confront`.
*(`controller.ts`, `events.ts`, `dmDirector.ts`, `eventDirector.ts`)*

### ✅ B6 — Personal stats only went up / LLM owned the cost sign *(resolved personal-stats fix)*
Energy/comfort changes were driven by the LLM's `pressure` field with no code-owned
baseline cost, and sleep reset energy to 100 nightly — so stats pinned at max and the
readiness gate + mastery had nothing to act on. The resolver now computes hybrid
tag+intensity costs (`BALANCE.cost`); sleep is partial restore (`BALANCE.recovery`).

### ✅ B5 — On-stream actions don't change affinity directly *(resolved §4 overhaul)*
On-stream actions now warm named viewers directly via `distributeActionAffinity`: the
verdict's **`connection`** score (0–3) and any **@mention** route through the
`applyAffinity` ledger (appeal-weighted, with per-stream repeat-tag decay), so a great
moment deepens specific bonds — not just the incidental chat burst. *Previously:*
affinity moved via chat messages, DMs, the **DM director**, and **in-person visits**,
but a great *on-stream moment* didn't itself warm a specific named viewer.
*(`relationships.ts`, `controller.ts`, `dmDirector.ts`)*

---

## C. LLM stack mismatches

### 🟡 C1 — "DMs use the strong model" is false when tiering is on
Settings help text and the LLM-tab label say the fast model is for "chat bursts" and
the main model handles "evaluator / narration / **DMs**." In reality **DM replies,
performance spoken lines, and the stream-memory summary all use the `chat` kind**, so
with `tieredModels` on they go to the **fast** model. *(`controller.ts`,
`SettingsPanel.tsx`, `types.ts` comment)*

### 🟡 C2 — Telemetry model name is wrong for fast-tier calls
`stats` records `provider.id`, whose getter always reports the **main** model, even on
a chat-kind call that actually used the fast model. The LLM tab also keeps only the
**last** call per kind (chat/story/other), so distinct call types overwrite each
other. *(`stats.ts`, `geminiProvider.ts`, `openRouterTextProvider.ts`)*

### 🟡 C3 — Streaming only really works for Gemini DMs
`streamReplies` only token-streams DM replies, and only on Gemini — the OpenRouter dev
proxy forces `stream:false`, so OpenRouter DMs arrive as one chunk. Chat/narration are
never streamed. *(`openRouterTextProvider.ts`, `providers.ts`, `controller.ts`)*

### 🟡 C4 — OpenRouter structured output is best-effort
The evaluator's JSON schema is sent to OpenRouter with `strict:false` (to dodge 400s),
so it's advisory there; only Gemini gets a real enforced `responseSchema`.
*(`openRouterTextProvider.ts`)*

### ✅ C5 — Spicy material could leak into non-spicy tiers via prompts *(fixed: content-tier hardening)*
Steering used to be the only guard, so spicy hints could slip into wholesome/cheeky
streams through static prompt content. Now structurally gated by intensity:
`segmentGuideForIntensity` filters the evaluator's segment list; `characterVoiceBlock`
caps the viewer `horny` axis and drops the "flirty undertone" voice tag below risqué
(so a whale seeded `horny +5` reads clean at wholesome); `allowedChatKinds` removes
`flirty` (<cheeky) / `creepy` (<risqué) from the chat schema + parser; the creepy
`door-knock`/`dm` branches require intensity ≥2; the `stalkers` segment and offline
persona suggestions are tier-gated; and the `workout`/`talent-dance` chat hints no
longer say "flirt". *(`prompts.ts`, `characters.ts`, `chatEngine.ts`, `events.ts`,
`segments.ts`, `activities.ts`, `controller.ts`)*

---

## D. Presentation / persistence seams

### 🟡 D1 — `roomImage` is stored in both places
The comment says big blobs live only in IndexedDB, but `partialize` still persists the
full `roomImage` data URL to localStorage too (risking the ~5 MB cap). IndexedDB is
authoritative on boot. *(`store.ts`, `boot.ts`)*

### 🟡 D2 — Inactive save slots show no portrait thumbnail
`getImage` filters by the active slot, so a save card for a non-active slot can't load
its `portraitId` thumbnail. *(`saves.ts`, `imageStore.ts`, `SettingsPanel.tsx`)*

### ⚪ D3 — Viewer portraits & style previews are global across slots
Keyed only by char id / preset id, so different worlds can share the same viewer
avatar or preview. *(`imageProvider.ts`, `imageStore.ts`)*

### ⚪ D4 — Image backend can't be chosen independently
There's no separate image-provider setting; image routing follows `textBackend`.
*(`imageProvider.ts`)*

### ✅ D5 — Default image prompts assume "her" *(fixed: pronoun pass)*
Presence/scene templates no longer hardcode "she/her". `imagePromptVars` now derives
`{{subj}}/{{obj}}/{{poss}}` from `settings.gender` (via `genderTerms`) and the templates
use `{{poss}}` / `{{name}}`. The same pass also fixed the doubled period after
face/body descriptions: `imagePromptVars` strips a trailing period so the template's
own punctuation isn't duplicated. Gendered phrasing was also neutralized (actual
pronouns or gender-neutral text) across the LLM system/context prompts in
`prompts.ts`, `content.ts` (`steeringForTier`), `evaluator.ts`, `eventDirector.ts`,
`activities.ts`, `chatEngine.ts`, and the `cameras.ts` fallbacks.
*(`characterVisual.ts`, `imageProvider.ts`, `imagePresets.ts`, `controller.ts`)*

### ✅ D6 — `backendChip` now reactive *(fixed: auth-gated LLM overhaul)*
`App.tsx` now uses `useStore` selectors for `textBackend` and `hasSession`, so the
chip updates on login/logout and backend changes without a reload. Additionally,
the old `fetchOpenRouterStatus()` that returned `true` whenever `VITE_SUPABASE_URL`
was set (without checking auth or deployment) has been replaced: the OpenRouter
instance is created when `supabaseConfigured`, but routing is gated on `hasSession`
in `pick()`. The real probe (`probeOpenRouterStatus`) fires after session confirmation
in `useCloudSync` and can toast a failure rather than silently routing to a 401.
*(`App.tsx`, `providers.ts`, `boot.ts`, `llm/openRouterStatus.ts`, `auth/useCloudSync.ts`)*

### ✅ D6b — OpenRouter catalog + profile/CORS seams in prod *(fixed)*
Four prod-only seams uncovered once Discord login + per-user keys shipped:
- **Catalog hit the dev proxy in prod.** `openRouterCatalog.ts` was hardcoded to
  `/__openrouter/models` (Vite-only); now targets the edge function `/models`
  with a Bearer JWT when `supabaseConfigured`.
- **CORS rejected `x-request-id`.** The dev-only request id header tripped the
  edge function preflight; it's no longer sent in prod, and `x-request-id` was
  added to the function's `Access-Control-Allow-Headers`.
- **Missing `profiles` rows.** Users predating the `handle_new_user` trigger had
  no profile, so the tier read 406'd and saves/key-minting hit FK violations.
  Migration `004` backfills profiles from `auth.users` and re-asserts the trigger;
  `useAuth.fetchTier` uses `.maybeSingle()` so a gap degrades to `free`, not a 406.
- **`/__diag-log` 405 spam.** The diag server sink (`toServer`) now only mirrors in
  `import.meta.env.DEV`, silencing the per-log 405 in prod.
*(`llm/openRouterCatalog.ts`, `openrouter-proxy/index.ts`, `migrations/004`, `auth/useAuth.ts`, `diag/log.ts`)*

### ✅ D7 — Live state now survives a reload *exactly* (fixed)
`session`, the roster's `online` flags and the `audience` snapshot are all persisted, so
a mid-stream refresh/load reproduces the **exact** room it was saved in — same cast
online, same audience mix, same viewer count — instead of re-rolling presence. `boot.ts`
no longer strips online flags, and `controller.resumeLive()` only restores internal
counters: it does not touch presence, fabricates no "joined"/welcome-back chat, and the
ambient loop resumes on the player's next action.
*(`store.ts`, `boot.ts`, `controller.resumeLive`)*

### ✅ D8 — Explicit NSFW options dev-gated *(fixed)*
The **No Limits** tier selector, **Masturbate on Cam** activity, and **`__relieve__`**
private action now require both No Limits tier **and** a dev build
(`NSFW_BUILD = import.meta.env.DEV`). Prod Settings use `CONTENT_TIERS_SETTINGS`
(no unhinged option); ActivityPicker filters `devOnly` activities; zone menus and
`activityGate` use `nsfwUnlocked`. Custom tier and risqué quick actions (Flirt /
Something daring) remain in prod. Horny mechanics via `isNoLimits` are unchanged.
*(`content.ts`, `activities.ts`, `ActivityPicker.tsx`, `SettingsPanel.tsx`, `controller.ts`)*

---

## E. Dead / unused code

| Symbol | File | Note |
|--------|------|------|
| `eventChance(base, intensity)` | `events.ts` | Exported, unused; events are state-driven via Event Director. |
| `nightProgress(clock)` | `time.ts` | Never used for event gating. |
| ~~`mult.viewer`~~ | `shop.ts` | **Now read** by `presenceTick` (A1 resolved). |
| `hypePerRound` / `energyPerRound` | `activities.ts` | Applied per live beat via `applyActivityRoundCosts` (see A2). |
| `HANDLES`, `MOD_HANDLES` | `personas.ts` | Dead; anon handles are procedural. |
| `deletePortrait(charId)` | `imageStore.ts` | Exported, never called. |
| re-exports `steeringForTier`, `fillPrompt` | `evaluator.ts` | Unused re-exports. |
No `TODO`/`FIXME` markers exist in `src/`.

---

## F. Biggest "room for improvement" themes

These are design gaps more than bugs (and most are tracked in
[`../IMPROVEMENTS.md`](../IMPROVEMENTS.md)):

1. **Economy is second-draft.** The §4 overhaul added centralized `BALANCE` curves, a
   monetization ramp, a recurring utility bill, and recurring sub income (A4) for a real
   early-game difficulty arc; still no win/lose/eviction. *(IMPROVEMENTS §4)*
2. **Viewer gear & niches now bite.** `mult.viewer` is wired (A1), dissatisfied segments
   leave faster (A3), and gear/niche/outfit appeal + spawn bias steer the audience
   mechanically. *(A1, A3)*
3. **Arcs are shallow.** 4 chains (sponsorship, viral, stalker-legal, relationship),
   day-boundary-only, two of them ≤2 stages; the engine is data-driven so more are
   cheap. *(A8, IMPROVEMENTS §3)*
4. ~~**Cameras/set design unbuilt.**~~ **Implemented (§11):** zone-gated go-live, placeable
   cameras + portable cam, multi-angle switcher, cam footage gen, item inventory, item
   wardrobe with stackable vibes, NPC gifts → real items. *(was IMPROVEMENTS §11)*
5. **No audio, onboarding, or responsive layout.** *(IMPROVEMENTS §6–8)*
6. **Content is code, not data.** Archetypes/events/games/upgrades are hardcoded;
   moddability/content packs are aspirational. *(IMPROVEMENTS §9)*

---

## How to keep this doc honest

When you change a mechanic, update the relevant numbered doc (02–08) and, if you fix or
introduce a mismatch, add/remove the entry here. The per-area docs cite the source
files so a quick re-read confirms whether an entry still holds.
