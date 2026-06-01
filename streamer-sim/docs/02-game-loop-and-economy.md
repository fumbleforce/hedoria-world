# 02 — Game Loop, Metrics & Economy

All numbers below are the actual constants in source as of writing. Files:
`src/game/controller.ts`, `resolver.ts`, `time.ts`, `shop.ts`, `activities.ts`,
`studio.ts`, `content.ts`, `state/store.ts`, `game/types.ts`.

## Metrics

Persistent player stats (`Metrics`, initialized in `store.ts`):

| Metric | Range | Initial | Role |
|--------|-------|---------|------|
| `cash` | unbounded (2 dp) | **$250** (Normal; Easy **$550**, Hard **$90**) | Spendable money. |
| `followers` | ≥ 0 int | **35** (Normal; Easy **80**, Hard **10**) | Reach; scales presence target & follower gain; goal targets. |
| `subscribers` | ≥ 0 int | **1** | Tracked & goal-rewarded. Pays **recurring monthly income** (see Recurring sub income). |
| `currentViewers` | ≥ 0 int | **0** | Live viewer count (display). |
| `peakViewers` | ≥ 0 int | **0** | **Lifetime** peak (used by the 100-viewers goal). |
| `hype` | 0–100 | **20** | Momentum; decays while live; drives tips/spawns. |
| `energy` | 0–100 | **100** | Stamina; spent on active live beats + time drift; partial restore on sleep. |
| `comfort` | 0–100 | **90** | Wellbeing + boundaries; trolls/creeps lower it; readiness gate. Low comfort "feeds" stalkers. |
| `hunger` | 0–100 | **100** | Fed (100 = full); drains over time; eat/cook/order restore. |
| `bladder` | 0–100 | **100** | Relieved (100 = empty); drains over time; bathroom restores. |
| `hygiene` | 0–100 | **100** | Clean; drains over time; shower/freshen restore. |
| `horny` | 0–100 | **0** | Arousal; **No Limits / custom tiers only**; builds on spicy beats, halves on sleep, relief actions reduce. |
| `day` | int ≥ 1 | **1** | In-world day counter. |

`patchMetrics` clamps hype/energy/comfort/hunger/bladder/hygiene/horny to 0–100 and updates
`peakViewers = max(peakViewers, currentViewers)`. It also **auto-diffs** changes
into floating feedback bubbles (see [08 → Feedback layer](./08-ui-map.md)).

### Metrics taxonomy (how to think about them)
The flat `Metrics` object groups conceptually, and the rebalance treats each group
differently:
- **Personal — body & psyche** (persist, restored by lifestyle): `energy`, `comfort`,
  `hunger`, `bladder`, `hygiene`, and (when uncapped) `horny`. **Comfort is the escalation gate** (readiness, below).
- **Personal progression — who she's becoming**: **mastery** XP per skill domain
  (`store.mastery`, see Mastery). The lever that bends *personal costs* down.
- **Channel — the business / score** (persist): `cash`, `followers`, `subscribers`.
- **Live / momentum** (this stream only): `hype`, `currentViewers`, `peakViewers`,
  the `StreamSession` tallies (incl. `connectionTagCounts`).
- **World**: `day`, `clock`.

Readiness draws on *personal* stats to gate *channel* reward; mastery is the personal
lever that lowers personal cost over time.

### Balance module (`game/balance.ts`)
Every tunable constant in the sections below lives in one exported `BALANCE` object
(affinity weights/caps/decay, economy curves, subs, novelty, niches, readiness, gear,
mastery). `resolver.ts`, `controller.ts`, `presence.ts`, `relationships.ts`, and
`shop.ts` read from it, so the whole rebalance is tuned in one place.

**Difficulty** (`settings.difficulty`: `easy` | `normal` | `hard`; default **normal**):
Normal is the baseline `BALANCE` object. Easy and Hard are patch presets merged at
runtime via `getBalance(level)`. Patches tune **economy** (tips, follower growth,
passive discovery, rent, utilities, monetization ramp), **subs** (daily conversion,
churn), **needs** (drain rates, critical beat drains), **recovery** (sleep energy/
comfort), and **affinity decay per idle day**. Starting cash/followers for new games:
Easy **$550 / 80**, Normal **$250 / 35**, Hard **$90 / 10** (`startingMetrics()`).
Changing difficulty mid-save applies new balance rules immediately; cash/followers/day
progress are preserved.

**Event director** (`BALANCE.events`): throttle gaps (`minBeatsBetweenLive`,
`minDaysBetweenOffline`), follow-up caps, and per-capability clamp bands for
`EventEffect` parsing in `eventDirector.ts`. Event consequences route through the
same income/affinity/mastery hooks as the rest of the game (`recordTip`,
`bumpAffinity` with source `"event"`, `addMasteryXp`).

### Session (transient, NOT persisted)
Per-stream tallies in `StreamSession`: `round` (turn counter), `seconds`
(minutes elapsed since `streamStartClock`), `streamStartClock` (in-world clock when
this stream went live), `earnings`, `newFollowers`, `peak`. Reset on every `goLive`;
`streamStartClock` is set to the current clock at go-live (not forced to evening).

> Note the two peak metrics: `session.peak` (per stream) vs `metrics.peakViewers`
> (lifetime). Goals read the lifetime one.

## Time (`time.ts`)

| Constant | Value |
|----------|-------|
| `WAKE_TIME` | 540 min = **9:00 am** (new save + after sleep) |
| `STREAM_START` | 1200 min = **8:00 pm** (legacy pacing helper only) |
| `NIGHT_END` | 1560 min = **2:00 am** (legacy pacing helper only — no longer ends streams) |

Time **always advances** on every action (live or offline). Going live does **not**
reset the clock — you can stream in the morning, afternoon, or evening. A live stream
ends only on **energy ≤ 0** or manually — there is no hard clock cap (the old 2:00 am
auto-end was removed; energy already paces stream length).

**Time cost per action** (`TIME_COST`): trivial 15, light 20, medium 40, heavy 60,
continue 25 (minutes). Beats advance the clock quickly so a session reads as hours.
Event scenes are the exception — they advance only `BALANCE.events.beatMinutes`
(2 min) per beat so a charged moment can breathe.

**Live time drift** — every `advanceTime(minutes)` while live:
```
energy -= minutes × 0.12
hype   -= minutes × 0.10
hunger/bladder/hygiene -= drainPerMin × minutes  (always, live or offline)
critical needs → extra comfort/energy drain per live beat
round  += 1
seconds = clock − streamStartClock
```

### Needs (`game/needs.ts`, `BALANCE.needs`)
- Drains per minute: hunger **0.08**, bladder **0.21**, hygiene **0.06**.
- Below **35** (`warnBelow`): `needsStrain` lowers viewer pull (`needsFactor` down to **0.6** floor).
- Below **15** (`criticalBelow`): extra comfort/energy drain per live beat; throttled DM nag (`nagCooldownBeats` **6**).
- **Sleep** applies the same drains for `sleepDurationMinutes(clock)` (hours until 9:00 am), then small hygiene **+8** / hunger **−5** — bladder is **not** reset to full.
- **Physical cues** (`physicalCues`) feed narration/DM (public + private) and chat (`visibleCues` — public only; bladder is private, never in chat).

### Viewer drivers (`game/derived.ts`)
Displayed in Stats panel (and dev section when `settings.devMode`):
```
targetNamed = clamp(round(followers/22)+2, 2, 14) × viewerMult × needsFactor
anonFloor   = round(followers × 0.02 × (0.5 + hype/100)) × viewerMult × needsFactor
currentViewers = max(segment population sum, distinct recent chatters)
```

### Passive growth (while live + at sleep)
- **Followers / beat** (live `afterBeat`): `round(currentViewers × happyNorm × passiveFollowerRate(0.012) × reach)` — each gain posts a **follow** chat line (like tips).
- **Subs / beat** (live `afterBeat`): daily gain estimate spread over `liveBeatsPerDay` (48), scaled by `happyNorm` and hype; fractional accrual rolls into **sub** chat pings with tip-style effects.
- **Sub churn / day** (at `sleep`): `round(subscribers × subChurnRate(0.01))`; recurring sub payout every 30 days unchanged.

### Horny (No Limits / custom only — `isNoLimits` in `content.ts`)
- Builds on live beats with intimate tags × intensity + spicy chat (`flirty`/`creepy`).
- Sleep: `horny × 0.5` (else forced to 0).
- Relief: `__relieve__` token (−**65**), sexual visit outcomes (`hornySceneRelief` by intensity).
  **`__relieve__` is dev-only** (`nsfwUnlocked` = `NSFW_BUILD && isNoLimits` in `content.ts`); prod builds hide the menu option even at Custom tier.
- High horny slightly eases intimate **comfort** costs (`comfortEaseMax` **0.2** at horny 100).

### Viewer watch windows (`characters.ts` + `presence.ts`)

Each named viewer has `watchStart` / `watchEnd` (minutes since midnight, may wrap).
**Affinity extends the window** up to `BALANCE.watch.affinityExtendMax` (90 min each
side at 100 bond). Return/spawn/leave odds in `advancePresence` respect the extended
window — day streams skew cozy/daytime archetypes; evenings skew hype/simp crowds.
New spawns use `rollArchetypeForTime(intensity, clock)`.

## Going live, ending, sleeping

**`goLive`** — requires `energy ≥ 10` and not already live. Clears chat, resets the
session, clears all `online` flags, sets `audience = initialAudience()`, records
`streamStartClock = clock` (current time), `isLive = true`. Does **not** jump to
8:00 pm.

**`endStream`** — triggered manually or when `energy ≤ 0`. Sets `isLive = false`,
clears presence. **Does not advance the day.**

**`sleep`** (must be offline) — the day/rent step; sets `clock = WAKE_TIME` (9:00 am)
on the new day.

### Recurring sub income (`payRecurringSubs`)
On a `BALANCE.subs.cadenceDays` (30) boundary, pays
`subscribers × monthlyValue ($3.5) × mult.income` through the income path with a
prominent positive alert. Predictable recurring revenue vs. one-off tips is the main
early-game escape hatch.

## The economy

### Tips (live actions, in `resolver.ts`)
For each segment with `satisfaction > 55` and `population > 0`:
```
tip += ((sat − 55) / 45) × tipFactor × population × tipConstant(0.11) × mult.income
```
Then the total is scaled by **readiness × monetizationRamp × novelty**:
```
monetizationRamp = min(1, followers / 80)   // a tiny new audience barely tips
```
Segment `tipFactor`: hype 0.8, lonely 1.1, simps 1.6, trolls 0.2, cozy 0.9,
**whales 5.0**, stalkers 1.2. Whales/subs are the meaningful early lever.

### Follower gain (live actions, `resolver.ts`)
```
satWeightedHappy = Σ over happy segments: ((sat − 55)/45) × growthFactor × population
satWeightedHappy ×= readiness × novelty
reach            = 0.4 + min(1.8, followers / 500)
gainedFollowers  = max(0, round(satWeightedHappy × followerGrowth(0.16) × reach))
```
Segment `growthFactor`: hype 1.3, lonely 1.0, simps 1.1, trolls 0.6, cozy 1.0,
whales 0.4, stalkers 0.5.

### Readiness gating (`resolver.ts`, `BALANCE.readiness`)
Positive payoff (tips + followers) is gated by how *ready* the moment is — the
classifier stays pure; the resolver owns the numbers:
- **Audience fit** — `fit = Σ max(0, appeal)×pop / totalPop`; payoff scales by
  `(1−fitWeight) + fitWeight×fitNorm`. Spicy content with no simps/whales present →
  near-zero tips, while its negative appeal sours the cozy crowd who *are* there.
- **Comfort** — for `intensity ≥ 2`, payoff scales with comfort headroom **and** the
  comfort *cost* is amplified (up to ×1.8) when comfort is already low.
- **Energy** — `intensity ≥ 2` underperforms below 30 energy.
- **Hype** — big swings (`intensity ≥ 4`) convert better at high hype.

So the same "go spicy" verdict pays out wildly differently by context: build the
audience + comfort first, then escalation pays.

> **Offline actions apply stat pressure but no tips/followers** (resolver guards on
> live state).

### Chat-driven money/followers (`applyChatEffects`)
| Chat kind | Effect |
|-----------|--------|
| `donation` | `cash += amount × mult.income`, hype +1 |
| `sub` | subs +1, `cash += (amount ?? 5) × mult.income`, hype +2 |
| `follow` | followers +1 |
| `raid` | followers +5, hype +4 (chat kind); director `raid` effect also adds live viewers (+15×size max +45) |
| `troll` | comfort −0.6 |
| `creepy` | comfort −1 |

A message from a **named character** also grants a tiny **+0.05 affinity** through
the ledger (soft-capped per day — see [03](./03-social-systems.md)) and increments
their `messageCount`. Tips route through `recordTip`/`bumpAffinity`.

**Code-owned chat tips (`maybeTipPing`, `chatEngine.ts`).** LLM-mode bursts almost
never propose donations on their own, so after each live action/continue burst the
controller (`maybeChatTip`) rolls a code-owned tip: probability
`clamp(0.05 + hype/100×0.12 + min(0.1, whalePop×0.04), 0, 0.3)`, fires only when a
generous segment (whales / simps / lonely) is present. A whale (or `donator`)
attribution tips **$20–100**; anyone else **$3–15**. The line is a normal `donation`
message, so it flows through the same `recordTip` pipeline (cash, session earnings,
per-character `tipped`, affinity, milestones) and **bypasses** `monetizationRamp` —
this, plus subs, is the real early-game cash lever.

### Coded lifestyle costs
| Action | Cash | Other | Minutes |
|--------|------|-------|---------|
| Order food | −$15 (needs ≥$15) | energy +18, comfort +6, hunger +50 | 25 |
| Cook | — | energy +15, comfort +4, hunger +40 | 15 |
| Coffee | — | energy +10 | 8 |
| Nap | — | energy +22, comfort +3 | 45 |
| Eat (meal) | — | energy +12, comfort +5, hunger +90 | 25 |
| Bathroom | — | bladder → 100 | 5 |
| Shower | — | hygiene +95, comfort +8, energy +4 | 20 |
| Freshen (quick) | — | hygiene +25, comfort +5, energy +4 | 12 |
| Read fan mail | — | comfort +2 | 15 |
| Relieve (No Limits, dev only) | — | horny −65, comfort +4, energy −6 | 20 |
| Cozy outfit | — | comfort +7 | 10 |
| Cute outfit | — | comfort +3, hype +4 | 10 |
| Bold outfit | — | hype +6, comfort −3 | 10 |

> **Legacy:** preset outfit tokens (`__outfit_*__`) were replaced by the **item wardrobe**
> (bathroom → 👗 Change clothes). Appeal now comes from equipped clothing items with
> stackable vibe tags (see **Cameras & wardrobe** below).

### Day jobs (`jobs.ts`, `controller.ts`)

Early-game survival lever: a **scheduled offline shift** that pays a fixed wage.
State lives in `store.job` (`JobState | null`, persisted) — not in `settings`.

| Constant | Value |
|----------|-------|
| `EARLY_WINDOW` | 60 min before shift start (can't clock in yet) |
| `ON_TIME_GRACE` | 30 min after shift start (full wage) |
| `LATE_WAGE_FACTOR` | 0.6 (late still pays, counts as a bad day) |
| `MAX_STRIKES` | 3 consecutive bad days → fired |
| `APPLY_MINUTES_MIN/MAX` | 45–300, **randomized** per application (`randomApplyMinutes`) |

**Shift slots** (same-day only, no midnight wrap): morning 8:00–14:00, afternoon
13:00–19:00, evening 17:00–23:00.

**Presets** (`JOB_PRESETS` in `jobs.ts`): barista ($62), warehouse ($78), rideshare
($70), dog walker ($55), call center ($68), freelance designer ($88) — each with
`energyCost` and optional hygiene/comfort drains.

**Clock in** (`goToWork`, token `__work__`, door zone + Job panel): offline only,
once per day. Status from `shiftStatus(job, clock)`:

- **early** — toast, no time/pay
- **ontime** — full `wage`, strikes reset at sleep
- **late** — `wage × 0.6`, strike at sleep
- **over** — missed; strike at sleep if never worked

Clocking in (ontime/late) opens the **Work screen** overlay (`store.workSession`,
persisted) instead of resolving instantly: a generated workplace image (kind
`"work"`, cached per job so it renders once) plus LLM/offline shift flavor
(`WORK_FLAVOR_FALLBACKS`). Pay, time, and stat costs are **deferred** — `leaveWork`
("Head home") applies `cash`/energy/hygiene/comfort, sets the job's
`lastClockInDay`/`lastClockInOnTime`, then advances the clock to `shiftEnd` (via
`workMinutesRemaining`, min 15 min). The whole shift survives a mid-shift reload.

**Strikes** (`resolveJobDay` at `sleep()`, before `day` increments): if worked on
time → strikes = 0; if worked late or absent → strikes += 1; at 3 → job cleared +
alert.

**Job board** (`__job_board__`, `JobPanel`): apply preset or custom (title, wage
$40–120, slot). Applying takes a **random** 45–300 min and **replaces any current
job** — the panel shows a confirmation ("quit & apply") warning the hire time is
unpredictable. Onboarding step **Day job** sets `job` via `setJob` with no apply
time cost.

## The resolver, in detail (`resolver.ts`)

### Personal stat costs (code-owned, hybrid)

Energy and comfort are **spent resources** — the resolver computes costs from **tags +
intensity** (`BALANCE.cost`); the LLM's `pressure.energy/comfort` only nudges (amplify
on `down`, soften on `up`).

| Trigger | Effect |
|---------|--------|
| **Energy tags** (`energetic`, `skillful`, `hype`, `loud`, …) | Spend `energyPerIntensity (2.2) × intensity` (× Showmanship mastery) |
| **Restful tags** (`chill`, `cozy`, `calm`, …) when not active | Recover `recoverEnergyPerIntensity (1.2) × intensity` |
| **Comfort tags** (`flirty`, `teasing`, `suggestive`, `vulnerable`, …) | Spend `comfortPerIntensity (1.8) × intensity` (× Composure mastery; amplified when comfort already low) |
| **`setsBoundary` / `boundary-setting`** | Restore `+6` comfort |
| **Hype** | LLM `pressure` × magnitude (base hype **5** × `mult.hype`) |

Live time drift still drains energy/hype and needs each beat. Lifestyle coded actions (eat,
bathroom, shower, coffee, nap) are the main recovery levers between streams.

### Stat pressure (hype only)
The verdict marks hype as pressured `up`, `down`, or `none`. The delta:
```
pressureDelta = (±1) × base × (0.6 + intensity × 0.18)
```
Base: hype **5** (× `mult.hype`). Energy/comfort costs are code-owned — see above.
Example: hype-up at intensity 3 with `mult.hype` 1.1 → **+6.27** hype.

### Segment satisfaction drift (per segment, live)
```
appeal    = verdict.appeal[seg] ?? inferAppeal(likes, dislikes, tags)   // ±1 per tag match, clamp −3..3
satTarget = clamp(50 + appeal × 14, 0, 100)
sat      += (satTarget − sat) × 0.4      // moves 40% toward target each beat
```

### Comfort from the audience (live)
```
comfortFromAudience += comfortFactor × population × (sat / 100)
```
`comfortFactor`: lonely −0.04, simps −0.06, trolls −0.05, cozy +0.02, whales −0.02,
**stalkers −0.18**. (Hype: 0.)

### Stalker satisfaction (live)
`setsBoundary` → stalker satisfaction **−25**. Else, if the tier allows stalkers and
the action's tags include `vulnerable`/`suggestive`/`boundary-crossing` → **+12**.

> **The resolver never changes segment *population* directly** — populations are
> presence-driven. But strongly **dissatisfied segments now leave faster**: presence
> adds a per-character leave boost from their segment's satisfaction
> (`(55−sat)/55 × leaveOnDislikeBoost`), so pushing content a room dislikes visibly
> empties it. (Closes the old `segments.ts` "shrink & leave" gap — see
> [09](./09-expectation-vs-reality.md).)

## Actions

`ActionVerdict` (`actions.ts`): `plausible`, `tags` (from a closed set of ~29),
`intensity` 1–5, sparse `appeal` per segment (−3..3), `pressure` (up/down/none on
each stat), `narration`, optional `setsBoundary`, and **`connection` 0–3** (how much
the beat deepens a 1:1 bond — drives directed affinity). `PlayerAction` carries the
text, a `source` (`freeform | menu | furniture`), and an optional hint.

If a verdict is **not plausible**, the controller DMs the reason, toasts, and
returns early — no time advance, no resolve.

## Zones & token actions (`studio.ts`)

The studio is a **5×5 grid** with 6 zones; spawn is the couch:

| Zone | Cell | Freeform actions? |
|------|------|-------------------|
| Bed | [0,0] | yes |
| Streaming Desk | [4,0] | yes |
| Couch | [2,2] | yes |
| Kitchenette | [0,4] | yes |
| Bathroom | [4,4] | no |
| Front Door | [2,4] | no |

Clicking a zone moves the avatar there and opens its action menu. Menu options are
filtered by `liveOnly`. Non-token prompts (e.g. "sing a song for chat") go through
the full evaluate→resolve pipeline. **Token** prompts bypass the evaluator:

| Token | Effect |
|-------|--------|
| `__toggle_live__` | Go live / end stream (requires a **camera in current zone**) |
| `__sleep__` | Sleep (day +1, rent, reset) |
| `__game_picker__` | Open mini-game picker |
| `__cook__` | energy +15, comfort +4, hunger +40, 15 min |
| `__eat__` | hunger +90, energy +12, comfort +5, 25 min |
| `__coffee__` | energy +10, 8 min |
| `__nap__` | energy +22, comfort +3, 45 min |
| `__bathroom__` | bladder → 100, 5 min |
| `__shower__` | hygiene +95, comfort +8, 20 min |
| `__freshen__` | hygiene +25, comfort +5, 12 min |
| `__scroll__` | comfort +2, 15 min |
| `__relieve__` | horny −65, comfort +4, 20 min (No Limits + dev build; bed/couch) |
| `__order_food__` | −$15, energy +18, comfort +6, hunger +50, 25 min (toast if broke) |
| `__door__` | offline event roll or "empty hallway", 5 min |
| `__outfit_cozy__` / `__outfit_cute__` / `__outfit_bold__` | outfit effects (see table above) |
| `__work__` | day-job shift (offline; see Day jobs) |
| `__job_board__` | open Job panel |
| `__open_shop__` | open shop (door zone menu) |

## Activities (`activities.ts`)

The **activity** sub-state generalizes the old mini-game `playing` flag. While an
activity is active, the player keeps using the normal Actions/freeform box (hybrid
flavor layer — not a blocking scene loop). Started from **ActivityPicker** (ActionBar
"🎬 Activity" or desk token `__game_picker__`); includes prefilled catalogue entries
plus a custom freeform option.

While `activity` is set and live, **each action adds +1 appeal to every segment in
`activity.pleases`**, on top of the normal verdict. When the active activity is the
player's chosen **talent** stream mode (`settings.talent` → free catalogue entry in
`activities.ts`), each action adds **another +1 appeal** to that talent's
`pleases` segments and nudges verdict hype pressure up; per-beat **`hypePerRound`**
also gets **+2** (× `mult.hype`). Per beat (action or Continue):

- **`narrateActivityBeat`** — a dedicated LLM narration line in the story feed,
  steered by `activity.narrationHint`.
- **`hypePerRound` / `energyPerRound`** — applied from the catalogue definition
  (× `mult.hype` for hype).
- **Chat** — `chatCtx.activity` steers bursts (backseat gaming, clip requests, etc.).
- **Event Director** — `EventDirectorContext.activity` + `activity-deep` signal after
  3+ beats can author activity-specific scenes/notices.

`activity` is **persisted while live** (clears on reload if offline, or when the stream ends).

### Catalogue (categories)

| Category | Examples | Shop |
|----------|----------|------|
| game | horror, fps, cozy-farm, rhythm, dating-sim (Risqué+), variety-party | $40–$80 each |
| performance | read-aloud, ASMR (Risqué+), karaoke, workout, **talent modes** (singer, guitarist, …) | free |
| creative | cook-on-cam, body-paint (No Limits+) | free |
| intimate | masturbate-on-cam (No Limits+; dev build only) | free |

Games in the shop **Game Library** section unlock via `ownedActivities[]` (persisted).
Each activity may declare `requiredZone` — a **fixed** (non-portable) camera must be
placed in that zone or the activity is hidden from the picker and shop (portable cams
do not count). Examples: games and desk streams → `desk`; Cook on Cam / Chef's Table →
`kitchenette`; workouts and couch streams → `couch`; body painting → `bathroom`;
masturbate-on-cam → `bed`.
Custom activities use neutral `pleases` and LLM-built hints from the typed text.

### Talents (`talents.ts`)

Chosen during onboarding (`settings.talent`, default `singer`). Six presets each
define: a free **activity** (`talent-*` ids in `activities.ts`, gated by
`activity.talent`), **quick actions** merged into the live Actions menu
(`ActionBar`), and **pleases** segments for the synergy bonus above. Character
presets in `characterPresets.ts` include a matching default talent.

### Starter kit (`controller.generateStarterKit`)

Runs once when onboarding finishes (`finishOnboarding`, before the opening beat).
Guarded by `starterKitGranted`. LLM returns ~3 themed props/gifts from persona +
talent + niche; offline/mock uses templated kits in `offlineStarterKit`. Items land
in `inventory` with `meta.starterKit = "1"` (flavor only — no mechanical effects).

| Game | Pleases | hypePerRound | energyPerRound |
|------|---------|--------------|----------------|
| horror | hype, trolls | 9 | 5 |
| fps | hype | 8 | 6 |
| cozy-farm | cozy, lonely | 4 | 2 |
| rhythm | hype, simps | 7 | 4 |
| dating-sim | simps, lonely | 6 | 3 |
| variety-party | hype, cozy | 6 | 4 |

## Shop & upgrades (`shop.ts`)

`multipliersFor(ownedUpgrades)` aggregates owned upgrades into multipliers.

| Upgrade | Cost | Effect |
|---------|------|--------|
| usb-mic | $120 | viewer ×1.1, hype ×1.05 |
| ring-light | $90 | hype ×1.1 |
| 1080p-cam | $260 | *(migrated to placeable camera system — buy **1080p Webcam Kit** in Cameras shop)* |
| dslr-cam | $700 | *(migrated — buy **DSLR + Capture Card** in Cameras shop)* |
| studio-lighting | $320 | hype ×1.08, **productionQuality +1** |
| green-screen | $150 | income ×1.15 |
| lava-lamp | $110 | **segmentAppeal {cozy+2, lonely+1}** |
| neon-arcade | $160 | **segmentAppeal {hype+2, trolls+1}** |
| premium-backdrop | $420 | **segmentAppeal {whales+2}**, income ×1.05 |
| rgb-led-strip | $95 | **segmentAppeal {hype+2}** |
| velvet-throw | $85 | **segmentAppeal {simps+2, cozy+1}** |
| gold-framed-art | $280 | **segmentAppeal {whales+1, cozy+1}** |
| gaming-chair | $200 | comfortPerDay +4 |
| plant-wall | $130 | comfortPerDay +3, viewer ×1.05 |
| soundproofing | $180 | comfortPerDay +3 |
| loft-apartment | $1500 | viewer ×1.3, income ×1.1, **rentPerDay +25**, comfortPerDay +5 |

**Two gear axes** drive the money loop (cash → the right gear → the right audience
grows → more recurring income):
- **`productionQuality`** — a *global* lift (camera/mic/lighting) folded into per-segment
  baseline appeal (`× gear.productionQualityToAppeal`) — appeals to everyone, raises the
  ceiling.
- **`segmentAppeal`** — *targeted décor* adding passive baseline appeal to specific
  segments **and** nudging presence spawn weights, so you literally attract the crowd you
  invest in (lavalamp → cozy, neon → hype, premium backdrop → whales).

**Décor visualization:** furniture with `segmentAppeal` is décor (`isDecoration`).
Shop cards show a **Visualize / Regenerate** button (when an image backend is
configured) that calls `controller.visualizeDecoration` → `ImageKind` `"decoration"`
stored in `decorationImages[upgradeId]`. **`generateRoom`** passes owned décor preview
URLs as image refs and names them in the `{{upgrades}}` room prompt so generated room
art includes purchased pieces. New saves start with **`ownedUpgrades = []`** (bare
room — only functional zone furniture in the default SVG / base prompt).

> **`mult.viewer` is now wired**: `presenceTick` scales the named-cast target and the
> anonymous floor by it, so camera/gear upgrades finally grow the audience. (Closes a
> [09](./09-expectation-vs-reality.md) mismatch.)

### Wardrobe (`items.ts`, `wardrobe.ts`)
Clothing is **item-based**: pieces live in `store.inventory`, equip into
`store.equippedClothing` slots (head/top/bottom/feet/outer/accessory/full), and stack
**vibe tags** (casual/cozy/cute/bold) into segment appeal via `wardrobeAppeal()` with
diminishing returns. Shop → **Clothing** section with **Style** (All / Women's / Men's /
Unisex) and **Slot** filters — gender tags are **filter-only** (anyone can buy any piece).
**Underwear** shop entries require **Risqué** tier or higher; explicit pieces (sheer,
harness, micro, etc.) require **No Limits** (`minTier: "unhinged"`, Custom tier counts).
`buyClothing` enforces the same gates. Bathroom → **Change clothes**. Baseline
appeal clamp in the resolver is **±5** (raised from ±3 so stacking matters).

### Cameras & streaming zones (`cameras.ts`)
- New saves start with a **Desk Cam** (webcam tier) at the streaming desk only.
- **Go live** requires `cameraForZone(cameras, zone)` — couch/kitchen/etc. need a placed
  cam or a **Portable Streaming Cam** ($180, lower quality, any zone).
- Purchased kits land **unplaced** in inventory; place via zone menu **📷 Place … here**.
  **Private zones** (`PRIVATE_CAM_ZONES` = bed, bathroom) only offer placement on a
  **No-Limits** tier (`canPlaceCameraInZone`) — both the menu option and
  `placeCameraAtZone` enforce it, so tame tiers can never film those spots.
- A zone with a fixed camera no longer stacks more: the menu shows **🔄 Swap in <tier>**
  (moves the old cam back to the bag) and **🗑 Remove** (`unplaceCamera`, always available
  even on tame tiers so a previously-placed private cam can be cleared).
- **Active camera** (`activeCameraId`) sets the on-screen angle; StudioRoom cam switcher
  while live. Switcher, StreamView title, and inventory all label angles via
  `cameraDisplayLabel` → `<Location> · <Tier>` (e.g. "Bathroom · DSLR"), not the bare tier.
  Multi-angle production bump: +4% viewers per extra placed zone (cap +12%).
- **Active camera quality** feeds `productionQuality` (replaces global 1080p/dslr gear
  multipliers; legacy owned upgrades migrate to unplaced cams on load).
- **Off-camera:** live actions in a zone without the active angle skip chat/audience
  payoff (`isLive` false in resolver for that beat); ActionBar shows 🎥 Off camera.

### Outfit vibe (`outfits.ts`, `wardrobe.ts`)
No `settings.outfit` field — vibe is derived from equipped clothing via
`dominantOutfitVibe()`. Item tags stack through `wardrobeAppeal()`; segment weights live in
`OUTFITS`. Presets grant `starterClothingFor(preset.outfit, preset.gender)` at onboarding.

## Mastery — personal progression (`mastery.ts`, `BALANCE.mastery`)
Live actions earn XP in skill **domains** keyed off the verdict's *tags* (uniform,
never per-action-id):
- **Showmanship** (`energetic`/`skillful`/`hype`/`funny`/`loud`/`chaotic`) → lowers the
  **energy** cost of matching actions.
- **Composure** (`flirty`/`teasing`/`suggestive`/`bold`/`vulnerable`/`personal`/
  `boundary-*`) → lowers the **comfort** cost of intense content.

`level = floor(sqrt(xp / 24))`; `costMult = clamp(1 − level×0.04, 0.5, 1)` (floored at
50% — never free). XP (`xpPerIntensity 1.5 × intensity`) is added per matching live action;
level-ups surface as a prominent alert. **HUD chips always show both domains from Lv 0**
with progress % to the next level.

## Niches & go-live stream type (`niches.ts`, `store.streamNicheDraft`, `session.niche`)
The stream type (variety / cozy / gaming / just-chatting / spicy) is picked at the
**desk zone menu** beside **Go live**, stored in `streamNicheDraft`, and copied into
`session.niche` when the stream starts. It shifts presence **spawn weights** and adds
**baseline appeal** per segment. **Spicy** only appears when content tier is **Risqué**
or higher (`nichesForTier`). Freshness (`contentNovelty`) is keyed by niche id.
Mid-stream niche changes and follower switch costs are gone — pick again next stream.

## Novelty & burnout (`BALANCE.novelty`, `events.ts`)
Per-content **freshness** (`store.contentNovelty`, keyed by niche) drains
`drainPerRepeat` (0.18, floor 0.4) on each live action and dulls hype/tips/follower
gain; rest + variety recover it (`recoverPerRest` on sleep). Chronic low **comfort + energy/needs strain**
arms a **burnout event** (offline) that forces a rest choice.

## Content tiers (`content.ts`)

| Tier | `tierIntensity()` (chat/stalker gate/ActionBar, local-eval cap) | `controller.intensity()` (presence spawn bias) |
|------|---|---|
| wholesome | 0 (cap 2) | 0 |
| cheeky | 1 (cap 3) | 1 |
| risqué | 2 (cap 4) | 2 |
| unhinged | 4 (cap 5) | 3 |
| custom | 4 (cap 5) | 3 |

The tier sets the **ceiling**, not a floor — most content stays ordinary; the tier
just removes the cap. The engine doesn't hard-block actions on content grounds; the
LLM declines in-character at low tiers via the steering text.

> Mismatch: `unhinged`/`custom` map to **4** in the content/chat path but **3** in
> the presence path. See [09](./09-expectation-vs-reality.md).

### NSFW dev gate (`content.ts`)

Explicit NSFW UI is stripped in prod builds (`NSFW_BUILD = import.meta.env.DEV`):

| Feature | Dev | Prod |
|---------|-----|------|
| **No Limits** tier in Settings | shown (`CONTENT_TIERS_SETTINGS`) | hidden (Custom remains) |
| **Masturbate on Cam** activity | shown at No Limits/Custom | never shown (`devOnly` on activity) |
| **`__relieve__`** zone menu option | shown at No Limits/Custom | never shown (`nsfwUnlocked`) |

`isNoLimits` (horny resource, wardrobe underwear strip, etc.) still applies in prod when
Custom is selected; only the three explicit options above are dev-gated.

## One live action, end to end (worked example)

1. Evaluator returns: intensity 3, appeal `{hype:+2}`, pressure `{hype:up}`.
2. Resolver: hype += ~5.4 (pressure); each segment's satisfaction drifts 40% toward
   `50 + appeal×14`.
3. Tips from segments with sat > 55; followers from the weighted-happy formula.
4. Time +8 min (medium) → energy −0.96, hype −0.8.
5. Chat burst of `clamp(round(viewers/6) + 2, 3, 8)` messages reacts.
6. `presenceTick` reshapes who's online and the segment populations.
7. Event Director may author a scene or notice (state-driven; no fixed % roll).
