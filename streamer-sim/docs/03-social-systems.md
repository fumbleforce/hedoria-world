# 03 — Social Systems

The "people" of the game: the audience segments, the named viewers, how they come
and go, how chat is produced, how relationships deepen, the stalker arc, and DMs.

Files: `src/game/segments.ts`, `archetypes.ts`, `personas.ts`, `characters.ts`,
`presence.ts`, `chatEngine.ts`, `relationships.ts`, `controller.ts`, `state/store.ts`.

There are **two coupled layers**:

1. **Audience segments** — 7 economic buckets with `population` + `satisfaction`.
   They drive tips, followers, and comfort (see [02](./02-game-loop-and-economy.md)).
2. **Named cast** — procedurally generated viewers (handles, archetypes, affinity,
   memory) that appear in chat and the Regulars gallery and can be DM'd.

Presence ties them together: online named characters contribute to segment
populations, plus an anonymous floor.

## Audience segments (`segments.ts`)

| Segment | Label | tipFactor | growthFactor | comfortFactor | minIntensity* |
|---------|-------|-----------|--------------|---------------|---------------|
| hype | Hype Beasts | 0.8 | 1.3 | 0 | 0 |
| lonely | Lonely Hearts | 1.1 | 1.0 | −0.04 | 0 |
| simps | Simps | 1.6 | 1.1 | −0.06 | 1 |
| trolls | Trolls | 0.2 | 0.6 | −0.05 | 0 |
| cozy | Cozy Crowd | 0.9 | 1.0 | +0.02 | 0 |
| whales | Whales | **5.0** | 0.4 | −0.02 | 0 |
| stalkers | Stalkers | 1.2 | 0.5 | **−0.18** | 1 |

Each segment also has `likes`/`dislikes` tag lists used to infer appeal when the
verdict doesn't specify it.

**Initial audience** (`initialAudience()` at go-live): hype 2, lonely 3, simps 0,
trolls 1, cozy 4, whales 0, stalkers 0 (total 10) — but the first `presenceTick`
immediately recomputes populations, so these values barely matter.

\* `minIntensity` is documented as "the segment is only active at/above this tier"
but is **never enforced** when building populations or the anonymous spread. Only the
**archetype** `minIntensity` gates spawning. See [09](./09-expectation-vs-reality.md).

## Archetypes (`archetypes.ts`) — 20 templates

Each archetype has `id`, `label`, `segment`, `blurb`, `nameParts[]` (for handle
generation), `lines[]` (mock chat), and `minIntensity`.

| Segment | Archetypes (minIntensity) |
|---------|---------------------------|
| hype | hype-fan, backseat, memer, gamer (all 0) |
| cozy | lurker, cozy-regular, curious, mod, hype-mom (all 0) |
| lonely | softboy, parasocial, donator (all 0) |
| simps | simp, flirt (1) |
| whales | whale (0) |
| trolls | troll, critic (0), edgelord (1) |
| stalkers | creep, stalker (**2**) |

**Spawn weighting** (`rollArchetype`): the pool is archetypes with
`minIntensity ≤ intensity`. If stalkers are being weighted and the pool contains
stalker archetypes, there's a **60%** chance to draw from the stalker subset; else
uniform.

## Mock chat banks (`personas.ts`)

`LINES` holds canned chat lines per `ChatMessageKind`, used by the offline engine.

> `HANDLES` (30 fixed handles) and `MOD_HANDLES` are **dead** — nothing references
> them; anonymous handles are generated procedurally (`anon`/`viewer`/… + a random
> number).

## Named characters (`characters.ts`)

`CharacterSheet` fields include: `handle`, `realName` (the character's actual name —
self-knowledge, set at creation, always present), `displayName` (the name the
**player** has learned, else `""`), `archetypeId`, `vibe`, `wants`, `affinity` (0–100), `relationship`
(`RelationshipType`), `memory`, `tipped`, `messageCount`, `online`, `known`, `isMod`,
`threat` (0–3), clocks, `milestones[]`, `escalationDay`, `lastVisitDay` (day of the
last in-person visit / doorstep, `-1` = never; gates repeat meetups),
`streamsAttended`, `lastStreamDay`, `attendanceStreak`, `backstory`, `quirks`,
`hasPortrait`, `referredBy?`.

> `RelationshipType` (`none | romantic | sexual | dominant | submissive | married`)
> is now a live field, seeded to `"none"`. It is set by the **DM director** and the
> **visit scene** (gated by content tier + affinity — see below), and seeds the
> `relationship` follow-up arc.

**Relationship levels** (by affinity): stranger <15, familiar ≥15, regular ≥35,
friend ≥60, confidant ≥85.

**Seeding** (`seedCharacter`): affinity `randInt(2,12)`, `online: true`,
`threat: 1` if the archetype is in the stalkers segment else 0, `isMod` if the
archetype is `mod`, `displayName: ""`, `escalationDay: -1`.

**Handles** (`makeHandle`): two parts from the archetype + a random suffix
(`""`, `_`, `_x`, `99`, `_irl`, `ttv`, …), lowercased, max 22 chars.

**Avatars** (`avatarFor`): threat ≥2 → 🩸; mod → 🛡️; else a per-segment emoji. The
Regulars gallery shows "⚠ stalker" only at threat ≥2 (not threat 1).

## Presence — who's in the room (`presence.ts`)

Runs each beat (`presenceTick`) after live actions, go-live, and Continue.

**Target online named count:** `clamp(round(followers / 22) + 2, 2, 14)`.
(0 followers → 2; 220 → 12; 300+ → 14 cap.)

**Anonymous floor:** `round(followers × 0.02 × (0.5 + hype/100))`, spread randomly
across cozy/hype/lonely.

**Reputation** (spawn chance only): `min(1, followers / 300)`.

**Per beat:**
- **Leave** (each online char): `P = 0.08 + (1 − affinity/100) × 0.07` → 8% at
  affinity 100, 15% at affinity 0.
- **Return** (offline char, until target reached): `P = 0.05 + (affinity/100) × 0.12`
  → 5%–17%.
- **New spawn** (up to 6 attempts while under target): each attempt
  `chance(0.6 + reputation × 0.1)` (60–70%), then `rollArchetype`. Stalker bias per
  spawn: `chance(0.08 + intensity × 0.03)` → 8% at intensity 0, 20% at intensity 4.

**Attendance** (on a character arriving on a new stream-day): `streamsAttended++`;
`attendanceStreak` +1 if they were here yesterday else reset to 1. A streak ≥3 posts
a system chat ("N streams running 🔥"); affinity ≥35 posts a "joined" line.

**Viewer count display** (`syncViewers`): `max(totalViewers(audience),
distinct chatters in last 40 messages)`; a chat notification fires when the count
changes by ≥2.

At boot, all roster `online` flags are cleared; relationships/memory persist.

## Chat engine (`chatEngine.ts`)

`generateChatBurst(ctx)`:
- Mock adapter → `mockBurst`.
- Else LLM via `completeJsonWithRepair` + `parseChat`; on empty/failure → mock burst.

**LLM prompt** (`buildRequest`) includes: up to 12 online characters (handle,
archetype, affinity); chat **dynamics** hints (`describeDynamics` — troll baits simp,
mod vs troll, two friendly regulars "ship"); the last 6 chat lines; each regular's
last 3 lines (voice consistency); the rolling **stream memory** summary; and the
action context to react to.

**`parseChat`** accepts `{messages:[...]}` or a bare array; clamps user to 24 chars,
text to 200; validates kinds; links a message to a roster id by case-insensitive
handle match.

**Mock burst** (`mockBurst`): `max(1, count + randInt(−1,1))` messages; ~65% from a
random online named char; +20% chance of a cross-talk line if ≥2 online; +5% forced
follow. `fromCharacter` picks a kind by segment (stalkers→creepy at intensity ≥2,
simps 30% flirty, trolls 50% troll, hype 50% hype, mods 40% mod; whales/donators 25%
tip of $50–150 / $3–20).

**Chat volume** (controller + `chatEngine.ts`): burst size is hype-driven via
`chatBurstCount(hype, viewers, mode)` using `BALANCE.chat` — low hype yields
1–2 messages, high hype up to 12. Viewers add a small nudge on top. Continue
uses `continueMult`; ambient uses `chatAmbientPlan` (0 ticks below hype 12,
up to 8 ticks at full hype, faster gap when hyped, 1–3 messages per tick).

## Relationships & milestones (`relationships.ts`)

### The affinity ledger (`applyAffinity`) — the single write path

Affinity is **scarce and earned**. Every gain/loss routes through one function,
`applyAffinity(c, rawDelta, source, day)` in `relationships.ts`, which enforces:

- **Diminishing returns** — `gainScale = clamp(1 − affinity/pivot, floor, 1)`
  (pivot 115, floor 0.2). A confidant climbs ~5× slower than a stranger. Losses
  bypass this (boundaries always bite).
- **Per-character daily soft cap** — soft sources (`chat`, `action`, `mention`,
  `dmRepeat`) share a per-day budget (`dailySoftCap` = 6). Reciprocal investment
  (`tip`/`request`/`gift`/`visit`/`dm`/`referral`) **bypasses the cap** — getting
  someone to *do* something for you is the real lever.
- **Source weighting** — base `rawDelta` per source comes from `BALANCE.affinity.sources`.
- It returns `{ patch, applied, reason }`; the controller applies the patch, runs
  milestone checks, and the `reason` ("+1.0 bond · they tipped you") feeds the
  feedback layer (bubbles + event log).

**Affinity sources** (base weight → after diminishing + cap):
| Source | Base Δ | Notes |
|--------|--------|-------|
| `chat` (named line) | +0.05 | soft-capped; presence isn't intimacy |
| `action` (verdict `connection`) | up to +0.8 × connection × appealFit | only viewers whose segment *liked* it; per-stream repeat decay ×0.5ⁿ |
| `mention` (`@handle`, live only) | +1.0 | targeted; short-circuits appeal weighting |
| `dm` (first exchange/day) | +4 | once-per-day real bump (`lastDmAffinityDay`) |
| `dmRepeat` (same-day follow-ups) | +0.3 | soft-capped token |
| `tip` | min($×0.05, 6) | reciprocal, cap-exempt |
| `gift` / `request` | +2 / +3 | reciprocal, cap-exempt; **request** fires on **fulfillment** (Check completed), not on creation |
| `visit` (per-beat signal, on resolve) | +3…+6 | reciprocal, cap-exempt |
| `referral` (referred-friend spawn) | +6 | seeded warmer |
| `event` (Event Director capability) | ±delta | cap-exempt; via `bumpAffinity(..., "event")` |
| DM director `affinity` effect | ±delta | signed; gains diminish, losses bite |

**Decay** (`decayAffinities`, on sleep): any character idle longer than
`decayGraceDays` (1) loses `decayPerIdleDay[level]` (confidant −3 … stranger −0.5),
scaled by how close the bond was. `lastInteractionDay` is stamped by every routed
gain; decay does **not** stamp it. The Regulars card shows a ❄ cooling marker once a
bond is neglected. Already-fired milestones don't refire on a re-climb.

> **Design constraint — actions are uniform.** Affinity from an action keys *only*
> off the verdict (`connection`, `tags`, `appeal`), never off an action id/label/keyword,
> so a menu shortcut and a custom "write a haiku about @mara's cat" reward identically.

**Milestones** fire when a character's relationship-level index increases (handles
multi-level jumps):
- **familiar (≥15):** inline chat flavor line.
- **regular (≥35):** **name reveal** — `displayName` is set to the character's own
  `realName` (the name they've had all along); story beat.
- **friend (≥60):** default inline beat + spawns a referred friend + **+3 followers**.
  **Whales** instead trigger a patronage **event** (+$120, +1 sub, +4 comfort).
- **confidant (≥85):** **lonely/simp** archetypes trigger a confession **event**;
  others get an inline beat + **+2 followers**.

> **Names are self-knowledge, revealed (never forced).** Every character is seeded
> with a `realName` they know from the start; `characterVoiceBlock` feeds their full
> self (name, age, job, story) into every NPC-voice prompt, with the rule to share
> only what fits the relationship and to never censor (no `[Redacted]`). The player
> learns the name when it surfaces: the **regular milestone** exposes `realName`, or
> the NPC volunteers it in a DM and the **DM director** emits a structured `reveal`.
> All paths now resolve to the same `realName`, so it's consistent per character.

**Word-of-mouth** (`spawnReferredFriend`): on a friend milestone (non-whale), spawn a
new character with `referredBy` set, +6 affinity, a random archetype at the current
intensity. (No spawn if ≥16 already online.)

**Sour review** (`sourReview`, on block/report): −2 to −5 followers + a log line.

## The stalker arc

**Threat scale:** 0 (none) → 1 (seeded for stalker-segment archetypes) → 2 → 3
(real-world threat).

**Escalation** (`advanceStalkerArc`, each live beat, on the highest-threat online
stalker with `1 ≤ threat < 3`), gated by **all** of:
- archetype segment is `stalkers`,
- `escalationDay < day` (at most **one step per in-world day**),
- **`fed === true`**, which in code means **`comfort < 75`** only.

> The comment describes "fed" as oversharing + low comfort + ignoring creepy chat,
> but only the `comfort < 75` threshold is implemented.

On advance: `threat += 1`, `escalationDay = day`, a narrator beat, and (if the new
threat ≥2) a creepy chat line. When threat reaches **3**, the controller immediately
rolls the **`stalker-confront`** event (weight 3) and raises it, skipping the normal
event roll and ambient chat.

**Confrontation event choices** (`stalker-confront`, discrete-only, no freeform):
- **Block & report** — comfort +18, mood +4, followers −4 → threat 0, affinity −20,
  goes offline, sour review, and **starts the `stalker-legal` arc**.
- **Confront on stream** — hype +16, followers +12, comfort −10, mood −6 → threat 0.
- **Move apartments** — −$300, comfort +24, mood +6 → threat 0, offline.
- **Wait it out** — comfort −12, mood −6 (no resolution).

> The IMPROVEMENTS doc framed the arc as a strict chat→DM→door→IRL ladder. In
> practice it's a daily threat counter plus *overlapping* random events. The
> `door-knock` event goes creepy when the bound character has threat ≥1; the `dm` event
> goes creepy the same way but now arrives as a **real DM** (no modal) — the player
> answers it directly and the DM director can raise threat from there.

## DMs (`controller.ts`, `dmDirector.ts`, `store.ts`, `CharacterModal.tsx`)

- `dmThreads: Record<charId, DmLine[]>` is **persisted**.
  `DmLine = {role: "me"|"them", text, kind?, imageId?, amount?}` — `kind` distinguishes
  plain text from `image`/`gift`/`system` lines the director injects.
- `unreadDms: Record<charId, number>` (**persisted**) counts unseen inbound lines.
  `markDmUnread` bumps it (used by **incoming DMs**, below), `openCharacter`/`clearDmUnread`
  resets it. The Regulars gallery shows a 📨 badge and floats unread senders to the top.
- `sendDm` pushes your line, sets `dmBusy`, calls `dmReply` with full history, then:
  affinity **+3**, condenses memory (LLM ≤180 chars, or a mock note), marks `known`,
  updates `lastSeenClock`, checks milestones, and finally runs the **DM director**.
  The reply stays in the DM panel — it does **not** bleed into live chat.
- Replies stream token-by-token when `streamReplies` is on and the provider supports
  it (Gemini); otherwise they arrive in one chunk. Capped at **280** chars.

#### Incoming (unsolicited) DMs

The `dm` **event** trigger no longer opens a modal — it's delivered as a real DM. When
rolled, `deliverIncomingDm` writes an opener in the sender's voice (`composeIncomingDm`,
seeded warm vs. creepy-too-specific), pushes it into their thread, flags it unread, and
notifies the player (system chat line when live + toast + log line). The player replies
in the panel like normal, so the **DM director** owns the fallout. See
[04 → Incoming DMs](./04-events-arcs-goals.md).

### DM director — consequences (`dmDirector.ts`)

After each exchange, `directDm` reads the recent thread and returns a list of
structured `DmEffect`s (LLM via `completeJsonWithRepair` + JSON schema; an offline
keyword fallback covers the mock backend). `applyDmEffects` then makes each one real:

| Effect | What it does |
|--------|--------------|
| `tip {amount}` | routed through the shared **`recordTip`** path (same money pipeline as live-chat donations); posts a 💸 gift line. Clamped ≤120. |
| `gift {item}` | comfort bump + 🎁 DM line + **adds a real item** to `store.inventory` (clothing-like names become equippable `ClothingItem`s). |
| `image {subject}` | generates a candid "photo" via the image backend, stores it, posts an inline image line. |
| `reveal {name}` | sets `displayName` (only if still unknown) + marks `known`. |
| `request {ask}` | creates a structured **`ViewerRequest`** (`viewerRequests[]`), posts a linked system DM line (`requestId`), appends memory, toast. Promised reward locked at creation: default **+3 bond** (`BALANCE.affinity.sources.request`) or **cash** when the viewer named a tip (`rewardType`/`rewardAmount` from the director). Affinity/cash pays out only on fulfillment (see below). |
| `affinity {delta}` | ±8, then milestone check. |
| `threat {delta}` | ±2 (clamped 0–3); can feed the stalker systems. |
| `relationship {type}` | sets `CharacterSheet.relationship`, **gated** by `allowRelationship` (affinity ≥45; `romantic`/`married` allowed above that, the more explicit types only at `risque`/`unhinged`/`custom` tiers). |
| `meetup {hint}` | schedules a **pending visit** (`addPendingVisit`, due same in-world day). **Suppressed** if a visit is already pending for them, a scene is active, or they visited within `VISIT_COOLDOWN_DAYS` (3) — so re-detecting an old "coming over" line on a later DM can't double-book. |
| `none` | nothing actionable happened. |

### Tip unification (`recordTip`)

Live-chat `donation`/`sub` lines, DM `tip` effects, **and the `tip-spike` event**
(delivered as a passive 💸 ding, not a modal — see
[04](./04-events-arcs-goals.md)) all flow through one
`recordTip(charId, amount, opts)` helper: `cash += amount × income multiplier`,
session `earnings` (only while live), lifetime `tipped`, affinity bump, and milestone
check — so a DM tip behaves identically to a chat tip. The seasonal `b.cashTips`
tailwind is a separate flat bonus and does not pass through `recordTip` (no
double-count).

### Visits (`pendingVisits`, the doorstep event, the guest scene)

A scheduled `meetup` becomes a **pending visit** (one per character — `addPendingVisit`
dedupes by `charId`). On the next **offline** beat (Continue, answer-the-door, or
waking up — never mid-stream), `consumeDueVisit` raises a **doorstep `GameEvent`**
(`triggerId: "dm-visit-door"`, bound to the character, tone seeded by threat/affinity)
with choices *Let them in / Don't answer / Tell them to leave* plus freeform. The
character's `lastVisitDay` is stamped the moment they reach the door (even if you turn
them away), starting the meetup cooldown.

- Declining resolves as a normal one-shot freeform/choice event.
- **Letting them in** starts a transient **guest scene** (`visitor` state, persisted).
  It plays out **inline** — not in a modal: the guest appears on the room map by the
  couch, the `ActionBar` switches to a "🏠 In person" meeting mode, and beats stream
  into the main narrator feed. The streamer's **Act** input feeds `visitBeat(text)`;
  **Continue** calls `visitContinue()` (the player hangs back and the guest takes the
  lead). Both route through `runVisitBeat`, judged by `judgeVisitBeat`, which returns a
  3–5 sentence beat **including the visitor's spoken dialogue**, clamped `effects`,
  `relationshipSignal`, `threatDelta`, and `sceneEnd`. The **LLM ends** the scene (hard
  cap ~7 beats), or the player can **"See them out"** (`endVisit`). While a visit is
  active, **Go Live / Sleep / Shop are disabled**. `resolveVisit` then applies the
  cumulative relationship type (gated), affinity, threat, condenses an "you met IRL"
  memory, stamps `lastVisitDay`, and — if it ended warm and low-threat — seeds the
  **`relationship` follow-up arc**.

These are distinct from the `dm` **event** trigger (a modal interrupt) — see
[04](./04-events-arcs-goals.md).

### Viewer requests (`viewerRequests`, `requestJudge.ts`)

When the DM director emits a `request` effect, `applyDmEffects` creates a persisted
**`ViewerRequest`** (`types.ts`: `id`, `charId`, `ask`, `status`, `rewardType`,
`rewardAmount?`, `createdDay`, `fulfilledDay?`, `evidence?`). Status lifecycle:
`open → fulfilled` or `open → dismissed` (terminal states never re-evaluate).

- **Creation:** `addViewerRequest` + DM system line with `requestId`. Hybrid rewards:
  promised payout locked from conversation (cash if they named a tip; else affinity +3).
  Toast: "New request from {handle}".
- **Dismiss:** `controller.dismissRequest(id)` — no reward, no penalty; memory note
  optional ("you passed on their ask").
- **Fulfillment:** player hits **Check completed** in the Requests panel
  (`controller.checkRequestCompletion()`). One batched LLM call via
  `judgeRequestFulfillment` (`requestJudge.ts`) compares all open requests against
  `streamMemory`, recent story beats, and recent chat. Code applies numbers:
  - cash promise → `recordTip(charId, rewardAmount)` (same pipeline as DM tips)
  - default → `bumpAffinity(..., BALANCE.affinity.sources.request, "request")`
  - optional bonus affinity 0–2 when above-and-beyond (`BALANCE.request.fulfillmentBonusMax`)
  - thank-you DM line, memory/interaction log, evidence stored on the request
- Works **live or offline** (judges recent story, not just the live session).
- **Migration:** old saves with only `request:` DM lines backfill into `viewerRequests`
  on load (`migrateDmRequests` in `store.ts` merge).

## Numbers cheat-sheet

```
Affinity thresholds:   15 / 35 / 60 / 85
Seed affinity:         2–12
Diminishing returns:   gainScale = clamp(1 − aff/115, 0.2, 1)
Daily soft cap:        6  (chat/action/mention/dmRepeat; tips/gifts/etc bypass)
Chat affinity / msg:   +0.05  (soft-capped)
DM affinity / day:     +4 first exchange, +0.3 same-day repeats
@mention (live):       +1.0 targeted
Tip affinity:          min($×0.05, 6)  reciprocal, cap-exempt
Referral bonus:        +6
Decay / idle day:      confidant −3 … stranger −0.5 (grace 1 day)
Block/report affinity: −20  (soft boundary −10)
Target online named:   clamp(followers/22 + 2, 2, 14) × viewerMult
Spawn attempt chance:  0.6 + min(1, followers/300)×0.1
Stalker spawn bias:    8% + intensity×3%  → 60% pick stalker archetype
Leave probability:     8%–15% + dislike boost (dissatisfied segments leave faster)
Return probability:    5%–17%
Stalker escalate:      comfort < 75, ≤1/day, threat 1→2→3
Online friend cap:     16
Sour review:           −2 to −5 followers
```
