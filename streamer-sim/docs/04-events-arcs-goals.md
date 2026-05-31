# 04 — Events, Arcs & Goals

Files: `src/game/events.ts`, `eventDirector.ts`, `goals.ts`, `calendar.ts`, `types.ts`,
`controller.ts`, `state/store.ts`, `ui/EventModal.tsx`, `ui/GoalsPanel.tsx`.

> The legacy multi-step `arcs.ts` chain system was removed — the director composes
> equivalent threads on the fly with `scheduleFollowup` / `meetup` seeds.

## When events fire

Events are **director-authored**, not hardcoded rolls. On each live `afterBeat`,
offline `continueStory`, or `answerDoor`, the controller calls
`maybeTryDirectorEvent` when a code throttle allows it (see `BALANCE.events` in
[02](./02-game-loop-and-economy.md)):

| Context | Mechanism |
|---------|-----------|
| Live, every `afterBeat` | `authorEvent(eventDirectorContext)` after stalker escalation — returns a scene, a notice, or null |
| Offline `continueStory` | same director gate; due follow-up seeds checked first |
| Offline `answerDoor` | due visit doorstep first, then director |
| Stalker hits threat 3 | `mustAddress` signal — bypasses min-gap throttle; static fallback if LLM declines |
| Burnout pressure (mood<35 & comfort<45 offline) | `mustAddress` signal with forced-rest fallback |
| Due **pending visit** (offline) | `consumeDueVisit` → `dm-visit-door` modal (unchanged) |
| Due **pendingEventSeed** | re-authors a seeded scene via `authorEvent(..., seed)` |

There is **no fixed probability** (the old 28%/40% rolls are gone). Calm state →
usually null; high-signal state → frequent scenes. Guardrails: one scene at a time,
`minBeatsBetweenLive` (4) / `minDaysBetweenOffline` (1).

Legacy `EVENT_TRIGGERS` in `events.ts` remain for reference and passive delivery
flags (`deliverAsDm`, `deliverAsTip`) but are no longer rolled ambiently.

## Event Director (`eventDirector.ts`)

Two LLM roles:

1. **`authorEvent`** — reads a compact state snapshot (+ signals) and returns
   `{ spec: EventSpec | null }`. Mode `scene` starts an interactive beat loop;
   mode `notice` narrates once and applies immediate effects.
2. **`resolveEvent`** — after a scene ends, returns `EventEffect[]` (the capability
   vocabulary) applied by `applyEventEffects` in the controller.

Per-beat narration uses **`judgeEventBeat`** (mirrors visit scenes). Consequences
surface through the **feedback layer** (`setFeedbackContext` + auto-diff bubbles).
Each beat also advances the clock by `BALANCE.events.beatMinutes` (2 min) — time
passes during a scene, but far slower than a normal turn so the moment can breathe.

**Author must back narration with capabilities.** The `authorEvent` prompt forbids
narrating a consequence (a DM, a tip, a follower spike, a gift, a raid) without the
matching effect. In particular, anything that is "someone messages her privately"
should be a `notice` carrying an `incomingDm` effect (with the literal `message` text
and a `charRef` sender) — a real DM then lands in the inbox and she replies in the DM
panel, where the DM director takes over. This is the same passive path as the legacy
`deliverAsDm` flag, now expressed as a first-class capability.

### Capability vocabulary (`EventEffect`)

| Capability | Hook |
|------------|------|
| `metric` | `patchMetrics` (clamped) |
| `money` | income path / `recordTip` |
| `followers` / `subscribers` | `patchMetrics` |
| `affinity` | `bumpAffinity(..., "event")` via affinity ledger |
| `threat` / `relationship` / `revealName` | character patch (gated) |
| `blockViewer` | block + `sourReview` |
| `spawnViewer` | `seedCharacter` |
| `incomingDm` | real DM into the inbox (`pushDm` + `markDmUnread` + notify) |
| `grantUpgrade` / `grantItem` | shop / flavor |
| `masteryXp` | `addMasteryXp` |
| `raid` | followers+hype bump (like chat raid) |
| `meetup` | `addPendingVisit` → visit scene |
| `scheduleFollowup` | `pendingEventSeeds` queue |

## Legacy catalogue (`events.ts`) — no longer ambiently rolled

Each event below was previously rolled by weight. Only passive delivery paths remain active if raised explicitly:

| Event | Notes |
|-------|-------|
| **tip-spike** | Passive 💸 via `deliverAsTip` if raised |
| **dm** | Real DM via `deliverAsDm` if raised |
| **dm-visit-door** | Still raised by due pending visits |
| *(others)* | Retired from ambient rolls — director composes equivalents organically |

## Old weighted triggers (reference only)

### Incoming DMs (the `dm` trigger — no modal)

A DM has an obvious **in-game answer** (just reply), so the `dm` trigger no longer
opens a modal with canned "Reply kindly / Leave it" choices. When the roll picks it,
`raiseEvent` sees the event's `deliverAsDm` seed and routes to `deliverIncomingDm`
instead:

1. The bound sender (or, if none was bound, a known regular / any roster char via
   `pickDmSender`) gets an **opening line written in their voice** (`composeIncomingDm`
   — an LLM `chat` call seeded by the flavor: a *warm/heartfelt* opener, or for
   threat≥1 & intensity≥1 an *unsettling, overly-specific* one; mock backend uses an
   archetype line).
2. The line is pushed into that character's `dmThreads`, the thread is flagged
   **unread** (`markDmUnread`, unless its panel is already open), and a notification
   fires: a system chat line (when live) + a toast + an event-log line.
3. An `EventRecord` is still written so cooldowns treat `dm` as recently fired.

The player answers in the **DM panel** like any other conversation, so consequences
(tips, gifts, threat, affinity, relationship, meetups) flow through the existing **DM
director** (`dmDirector.ts`) rather than a fixed `effects` payload. The Regulars gallery
shows a 📨 badge and floats unread senders to the top; `openCharacter` clears the flag.
`unreadDms` is persisted. `GameEvent.deliverAsDm` is the opt-in flag, so other "this is
really just a message" events can be routed the same way later.

### Incoming tips (the `tip-spike` trigger — no modal)

A donation has an obvious in-game answer — the **"🙏 Thank a supporter"** quick action —
so `tip-spike` no longer opens a modal with "Read it out / Thank quietly" choices. When
rolled, `raiseEvent` sees `deliverAsTip` (the amount, ∈ {20,30,50,75,100}) and routes to
`deliverIncomingTip`:

1. The money lands through the shared **`recordTip`** pipeline (`hype +1`, affinity
   `+0.9`, `tipped`, session `earnings`, milestone check) — identical to a chat/DM tip.
2. A 💸 **donation chat line** is pushed (attributed to the bound viewer) and a **toast
   dings** (`💸 $N tip from {name}!`), plus an event-log line.
3. An `EventRecord` is written so cooldowns treat `tip-spike` as recently fired.

It does **not** interrupt the stream (no `stopAmbient`, no `pendingEvent`). The player
can react organically — typically the **"🙏 Thank a supporter"** action, resolved by the
normal action evaluator. `GameEvent.deliverAsTip` is the opt-in flag.

### The DM visit doorstep (`dm-visit-door`)

Not part of the static `events.ts` catalogue — `buildVisitDoorEvent` constructs it on
demand from a **pending visit** (scheduled by a DM `meetup` effect; see
[03](./03-social-systems.md)). It is bound to the character, offline-only, tone keyed
to threat, and offers *Let them in / Don't answer / Tell them to leave* plus freeform.
Choosing to let them in (discrete **or** freeform matching `let…in/come in/invite/…`)
hands off to the **guest scene** instead of resolving immediately.

## Cooldowns & memory

- `store.recentEvents` keeps the last **14** `EventRecord`s (persisted).
- In `rollEvent`: the **most recent** trigger id gets weight **0** (can't repeat
  back-to-back); any id in the **last 4** gets weight **×0.25**. `stalker-confront`
  is exempt.
- `narrateEvent` may reference the most recent *different* event in its prose
  ("after last week's raid…").

## Story arcs (`arcs.ts`)

Data-driven multi-day chains. `startArc(kind, {...})` sets stage 0 and
`nextDay = day + stages[0].dayDelay`. `arcEventDue(arc, day)` builds the next stage's
event when `day ≥ nextDay`. `advanceArc` bumps the stage (or finishes the arc).

Arc due events are only checked at **`goLive`** (before ambient) and **`sleep`** (after
day increment) — **never mid-stream on the same day**. The same `maybeArcEvent` pass
also drains a due **pending visit** first (offline contexts only).

### Sponsorship — seeded by brand-deal "take it"
Data: `{ brand: random from BRANDS, offer: 50 + round(followers/4) }` (offer
recomputed at arc start).
| Stage | +days | Event | Choices |
|-------|-------|-------|---------|
| 0 | 1 | 📦 Deliverable due | Polished (+$offer, hype −3, comfort −2) / Phone it in (+$offer/2, hype +1) / Skip (followers −6, comfort +2) |
| 1 | 2 | 📧 Renewal | renewal = round(offer×1.6): Sign (+$renewal, hype −2) / **Push for more (gamble: +$renewal×2 or $0, comfort −2)** / Walk away (hype +4, mood +4) |

> **The gamble is decided at build time** (`Math.random()` when the event renders),
> not when you click — so the outcome is locked before you choose. See
> [09](./09-expectation-vs-reality.md).

### Viral — seeded by viral-clip "lean"
| Stage | +days | Event | Choices |
|-------|-------|-------|---------|
| 0 | 1 | 📈 The wave arrives | Welcome newcomers (followers +90, hype +8, comfort −2) / Keep doing you (followers +45, hype +4, mood +3) |
| 1 | 1 | 🔥 Backlash | Address head-on (hype +6, comfort −4, mood −2) / Ignore (mood −6, followers −10) / Double down (hype +12, comfort −10, mood −6, followers +8) |

### Stalker-legal — seeded by stalker-confront block/report
Single stage, +2 days: 👮 Police follow-up — Full statement (comfort +16, mood +6) /
Downplay (comfort +6, mood −2).

> Only the **`stalker-confront`** "block & report" starts this arc — the everyday
> **`dm`** event's "Block and report" does **not**.

### Relationship — seeded by a warm in-person visit
Seeded by `resolveVisit` (`maybeStartVisitArc`) when a guest scene ends with the
character at `threat < 2` and either a non-`none` relationship or affinity ≥ 60. Bound
to the character; only one per character at a time.
| Stage | +days | Event | Choices |
|-------|-------|-------|---------|
| 0 | 1 | 💌 The morning after | Tell them it did (mood +9, comfort +4) / Keep it casual (mood +2) / Pull back (mood −4, comfort +4) |
| 1 | 2 | 🍷 A second visit | Make a night of it (mood +12, comfort +8, energy −6) / Slow it down (mood +4, comfort +6) |

Multiple arcs can run at once; the Goals panel lists active arcs with their next day.

## Visit scene (the guest-present loop)

When you let a visitor in, a transient `visitor` scene state takes over (persisted
across reloads). It plays out **inline in the main UI** — the guest shows on the room
map by the couch and the `ActionBar` enters a "🏠 In person" mode — rather than in a
modal. Beats append to the main narrator feed. **Act** feeds `visitBeat(text)`;
**Continue** calls `visitContinue()` (player hangs back, guest takes initiative); both
go through `runVisitBeat` → `judgeVisitBeat` (LLM JSON: `narration` — 3–5 sentences
**with the visitor's spoken dialogue** —, clamped metric `effects`,
`relationshipSignal`, `threatDelta`, `sceneEnd`, `endReason`). The **LLM decides when
the scene ends** (hard cap ~7 beats); the player can also **"See them out"**
(`endVisit`). During a visit **Go Live / Sleep / Shop are disabled** and all action
input is routed into the scene. `resolveVisit` commits the accumulated outcome:
relationship type (gated by `allowRelationship`), affinity (`relationshipScore`),
threat (`threatDelta`), an "you met IRL" condensed memory, `lastVisitDay`, milestone
check, then the optional `relationship` arc. Mock backend uses a short scripted
fallback (which also includes dialogue).

## Goals (`goals.ts`)

Soft one-time objectives; `checkGoals()` (called on end stream, each live beat, after
event resolution, and after sleep) applies the reward once when met.

| Goal | Condition | Reward |
|------|-----------|--------|
| First 100 followers | followers ≥ 100 | hype +6, mood +5 |
| 100 concurrent viewers | **lifetime** `peakViewers` ≥ 100 | hype +8, mood +6 |
| 10 subscribers | subscribers ≥ 10 | cash +50, mood +6 |
| Bank a rent buffer | cash ≥ 2000 | mood +10, comfort +8 |
| 1,000 followers | followers ≥ 1000 | hype +12, mood +10, cash +100 |
| Survive a month | **day ≥ 30** | mood +12, comfort +10 |
| Go full-time | followers ≥ 10000 | hype +20, mood +18, cash +500 |

> "Survive a month" says "without going broke" but only checks `day ≥ 30` — there's
> no solvency requirement. "100 concurrent viewers" uses lifetime peak, not the
> per-stream peak.

## Calendar & seasonal beats (`calendar.ts`)

- **Day 1 = September 22, 2025** (`EPOCH`). `dateForDay(n)` maps a game day to a
  calendar date.
- `occasionForDay(day, {birthday})` checks, in priority order: configured **birthday**
  (`settings.streamerBirthday`, `MM-DD`) → fixed **holidays** → **anniversary**
  (every 365 days after day 1) → **monthly milestone** (every 30 days after day 1).

| Occasion | Date | ~Day | Bonuses |
|----------|------|------|---------|
| Birthday | from settings | varies | hype +14, mood +12, tips +$120 |
| Halloween | Oct 31 | 40 | hype +12, tips +$60 |
| Christmas | Dec 25 | 95 | hype +8, mood +8, tips +$100 |
| New Year's Eve | Dec 31 | 101 | hype +16, tips +$80 |
| Valentine's | Feb 14 | 146 | hype +10, tips +$90 |
| Anniversary | every 365 days | 366, 731… | hype +12, mood +10, tips +$70 |
| Monthly milestone | every 30 days | 31, 61, 91… | mood +6, tips +$25 |

**`applySeasonalBeat()`** runs only at `goLive`: it applies the bonus deltas, adds
tips to the session, posts a story line + toast. **There is no interactive themed
event** — seasons are a passive tailwind today.

## Freeform event resolution

When `allowFreeform` is true, `EventModal` shows a text box. `resolveEventFreeform`:
1. Calls `judgeEventResponse` — an LLM JSON call returning `{resolution, effects?}`,
   with deltas clamped (stats ±20, followers −30..60, cash ±300, subs −10..20).
2. Applies the metrics, pushes a story line, runs `finishEvent`.
3. Mock fallback: a generic resolution + `{mood:+1}`.

> Freeform resolution **skips** the discrete path's special logic: no stalker
> threat/online/sour-review handling, **no arc starts** (arcs only start from matching
> discrete choice **labels**), and no power-cut early end. `stalker-confront` disables
> freeform for exactly this reason.

## Persistence

Persisted: `recentEvents` (14), `arcs`, `completedGoals`, `eventLog` (50 lines),
`pendingVisits`, and the active `visitor` scene. Not persisted: `pendingEvent` (the
open modal). See [07](./07-persistence.md).
