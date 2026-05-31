# 02 — Game Loop, Metrics & Economy

All numbers below are the actual constants in source as of writing. Files:
`src/game/controller.ts`, `resolver.ts`, `time.ts`, `shop.ts`, `games.ts`,
`studio.ts`, `content.ts`, `state/store.ts`, `game/types.ts`.

## Metrics

Persistent player stats (`Metrics`, initialized in `store.ts`):

| Metric | Range | Initial | Role |
|--------|-------|---------|------|
| `cash` | unbounded (2 dp) | **$250** | Spendable money. |
| `followers` | ≥ 0 int | **35** | Reach; scales presence target & follower gain; goal targets. |
| `subscribers` | ≥ 0 int | **1** | Tracked & goal-rewarded. Pays **recurring monthly income** (see Recurring sub income). |
| `currentViewers` | ≥ 0 int | **0** | Live viewer count (display). |
| `peakViewers` | ≥ 0 int | **0** | **Lifetime** peak (used by the 100-viewers goal). |
| `hype` | 0–100 | **20** | Momentum; decays while live; drives tips/spawns. |
| `energy` | 0–100 | **100** | Stamina; drains while live; full reset on sleep. |
| `mood` | 0–100 | **70** | Wellbeing. |
| `comfort` | 0–100 | **90** | Boundary/parasocial pressure. Low comfort "feeds" stalkers. |
| `day` | int ≥ 1 | **1** | In-world day counter. |

`patchMetrics` clamps hype/energy/mood/comfort to 0–100 and updates
`peakViewers = max(peakViewers, currentViewers)`. It also **auto-diffs** changes
into floating feedback bubbles (see [08 → Feedback layer](./08-ui-map.md)).

### Metrics taxonomy (how to think about them)
The flat `Metrics` object groups conceptually, and the rebalance treats each group
differently:
- **Personal — body & psyche** (persist, restored by lifestyle): `energy`, `mood`,
  `comfort`. **Comfort is the escalation gate** (readiness, below).
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

### Session (transient, NOT persisted)
Per-stream tallies in `StreamSession`: `round` (turn counter), `seconds`
(`clock - STREAM_START`, i.e. minutes elapsed despite the name), `earnings` (cash
this stream), `newFollowers` (followers+subs this stream), `peak` (peak concurrent
**this stream**). Reset on every `goLive`; lost on reload.

> Note the two peak metrics: `session.peak` (per stream) vs `metrics.peakViewers`
> (lifetime). Goals read the lifetime one.

## Time (`time.ts`)

| Constant | Value |
|----------|-------|
| `STREAM_START` | 1200 min = **8:00 pm** |
| `NIGHT_END` | 1560 min = **2:00 am** |
| Stream window | 360 min (**6 hours**) |

**Time cost per action** (`TIME_COST`): trivial 1, light 3, medium 8, heavy 18,
continue 6 (minutes).

**Intensity → time weight** (`weightForIntensity`): intensity ≥4 → heavy (18); ≥3 →
medium (8); ≥2 → light (3); else trivial (1). Coded token actions pass explicit
minutes instead.

**Live time drift** — every `advanceTime(minutes)` while live:
```
energy -= minutes × 0.12
hype   -= minutes × 0.10
round  += 1
```
Example: an 8-minute (medium) action costs −0.96 energy and −0.8 hype.

> `nightProgress(clock)` exists in `time.ts` but is **not used** for event gating;
> the live event chance is a flat 28%.

## Going live, ending, sleeping

**`goLive`** — requires `energy ≥ 10` and not already live. Clears chat, resets the
session, clears all `online` flags, sets `audience = initialAudience()`, clock to
8:00 pm, `isLive = true`. Then applies a **seasonal beat** if today is an occasion,
raises a **due arc event** if one is pending (skipping ambient chat), else starts
ambient chat. Starting a stream does **not** spend energy (only the time drift does).

**`endStream`** — triggered manually, or when `energy ≤ 0`, or `clock ≥ 2:00 am`.
Sets `isLive = false`, `currentViewers = 0`, clears presence, shows a session
summary. **Does not advance the day or charge rent.**

**`sleep`** (must be offline) — the day/rent step:
```
day    += 1
energy  = 100
mood   += 8 + mult.moodPerDay
hype    = max(15, hype × 0.6)
comfort+= 6
cash   -= rent          // base $20/day; +$25 if loft owned → $45
cash   -= utilityBill   // BALANCE.economy.utilityAmount ($18) every 7 days
clock   = 8:00 pm
```
Then, in order: **recurring sub income** (on the 30-day cadence),
**novelty recovery** (rest freshens repeated content), and **affinity decay**
(neglected bonds cool — see [03](./03-social-systems.md)). The money debit is
surfaced as an explicit "rent & utilities" feedback bubble. Warns if cash goes
negative. (No bankruptcy/eviction loss exists yet.)

### Recurring sub income (`payRecurringSubs`)
On a `BALANCE.subs.cadenceDays` (30) boundary, pays
`subscribers × monthlyValue ($3.5) × mult.income` through the income path with a
prominent positive alert. Predictable recurring revenue vs. one-off tips is the main
early-game escape hatch.

## The economy

### Tips (live actions, in `resolver.ts`)
For each segment with `satisfaction > 55` and `population > 0`:
```
tip += ((sat − 55) / 45) × tipFactor × population × tipConstant(0.07) × mult.income
```
Then the total is scaled by **readiness × monetizationRamp × novelty**:
```
monetizationRamp = min(1, followers / 150)   // a tiny new audience barely tips
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
| `raid` | followers +5, hype +4 |
| `troll` | mood −0.6 |
| `creepy` | comfort −1 |

A message from a **named character** also grants a tiny **+0.05 affinity** through
the ledger (soft-capped per day — see [03](./03-social-systems.md)) and increments
their `messageCount`. Tips route through `recordTip`/`bumpAffinity`.

### Coded lifestyle costs
| Action | Cash | Other | Minutes |
|--------|------|-------|---------|
| Order food | −$15 (needs ≥$15) | energy +18, mood +6 | 25 |
| Cook | — | energy +15, mood +4 | 15 |
| Coffee | — | energy +10 | 8 |
| Nap | — | energy +22, mood +3 | 45 |
| Freshen up | — | mood +6, comfort +5, energy +4 | 20 |
| Read fan mail | — | mood +3, comfort −1 | 15 |
| Cozy outfit | — | mood +3, comfort +4 | 10 |
| Cute outfit | — | mood +3, hype +4 | 10 |
| Bold outfit | — | hype +6, comfort −3 | 10 |

## The resolver, in detail (`resolver.ts`)

### Stat pressure
A verdict marks each of hype/energy/mood/comfort as pressured `up`, `down`, or
`none`. The delta:
```
pressureDelta = (±1) × base × (0.6 + intensity × 0.18)
```
Bases: hype **5** (× `mult.hype`), energy **4**, mood **4**, comfort **5**.
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
| `__toggle_live__` | Go live / end stream |
| `__sleep__` | Sleep (day +1, rent, reset) |
| `__game_picker__` | Open mini-game picker |
| `__cook__` | energy +15, mood +4, 15 min |
| `__coffee__` | energy +10, 8 min |
| `__nap__` | energy +22, mood +3, 45 min |
| `__freshen__` | mood +6, comfort +5, energy +4, 20 min |
| `__scroll__` | mood +3, comfort −1, 15 min |
| `__order_food__` | −$15, energy +18, mood +6, 25 min (toast if broke) |
| `__door__` | offline event roll or "empty hallway", 5 min |
| `__outfit_cozy__` / `__outfit_cute__` / `__outfit_bold__` | outfit effects (see table above) |
| `__open_shop__` | open shop — **implemented but not wired into any zone menu** (only the ActionBar shop button opens the shop) |

## Mini-games (`games.ts`)

While `playing` a game and live, **each action adds +1 appeal to every segment in
the game's `pleases` list**, on top of the normal verdict.

| Game | Pleases | hypePerRound* | energyPerRound* |
|------|---------|---------------|-----------------|
| horror | hype, trolls | 9 | 5 |
| fps | hype | 8 | 6 |
| cozy-farm | cozy, lonely | 4 | 2 |
| rhythm | hype, simps | 7 | 4 |
| dating-sim | simps, lonely | 6 | 3 |
| variety-party | hype, cozy | 6 | 4 |

\* **`hypePerRound` and `energyPerRound` are defined but never applied** — only the
+1 appeal bump is used today.

## Shop & upgrades (`shop.ts`)

`multipliersFor(ownedUpgrades)` aggregates owned upgrades into multipliers.

| Upgrade | Cost | Effect |
|---------|------|--------|
| usb-mic | $120 | viewer ×1.1, hype ×1.05 |
| ring-light | $90 | hype ×1.1 |
| 1080p-cam | $260 | viewer ×1.25, **productionQuality +1** |
| dslr-cam | $700 | viewer ×1.35, **productionQuality +2** |
| studio-lighting | $320 | hype ×1.08, **productionQuality +1** |
| green-screen | $150 | income ×1.15 |
| lava-lamp | $110 | **segmentAppeal {cozy+2, lonely+1}** |
| neon-arcade | $160 | **segmentAppeal {hype+2, trolls+1}** |
| premium-backdrop | $420 | **segmentAppeal {whales+2}**, income ×1.05 |
| gaming-chair | $200 | moodPerDay +4 |
| plant-wall | $130 | moodPerDay +3, viewer ×1.05 |
| soundproofing | $180 | moodPerDay +3 |
| loft-apartment | $1500 | viewer ×1.3, income ×1.1, **rentPerDay +25**, moodPerDay +5 |

**Two gear axes** drive the money loop (cash → the right gear → the right audience
grows → more recurring income):
- **`productionQuality`** — a *global* lift (camera/mic/lighting) folded into per-segment
  baseline appeal (`× gear.productionQualityToAppeal`) — appeals to everyone, raises the
  ceiling.
- **`segmentAppeal`** — *targeted décor* adding passive baseline appeal to specific
  segments **and** nudging presence spawn weights, so you literally attract the crowd you
  invest in (lavalamp → cozy, neon → hype, premium backdrop → whales).

> **`mult.viewer` is now wired**: `presenceTick` scales the named-cast target and the
> anonymous floor by it, so camera/gear upgrades finally grow the audience. (Closes a
> [09](./09-expectation-vs-reality.md) mismatch.)

### Wardrobe outfits (`outfits.ts`)
The worn outfit (`settings.outfit`, set by the change-outfit actions) applies a passive
**baseline-appeal** nudge while live: cozy → cozy/lonely, cute → hype/simps,
bold → simps/whales (cozy −). A cheaper, faster lever than gear for shaping appeal.

## Mastery — personal progression (`mastery.ts`, `BALANCE.mastery`)
Live actions earn XP in skill **domains** keyed off the verdict's *tags* (uniform,
never per-action-id):
- **Showmanship** (`energetic`/`skillful`/`hype`/`funny`/`loud`/`chaotic`) → lowers the
  **energy** cost of matching actions.
- **Composure** (`flirty`/`teasing`/`suggestive`/`bold`/`vulnerable`/`personal`/
  `boundary-*`) → lowers the **comfort** cost of intense content.

`level = floor(sqrt(xp / 50))`; `costMult = clamp(1 − level×0.04, 0.5, 1)` (floored at
50% — never free). XP (`xpPerIntensity × intensity`) is added per matching live action;
level-ups surface as a prominent alert. This is the cost-efficiency half of the skill
stat; the payoff-readiness half (Phase 3b) stays a separate lever, so an experienced
streamer sustains escalation longer but still needs the audience built to get *paid*.

## Niches & schedule board (`niches.ts`, `BALANCE.niche`)
`settings.niche` (variety / cozy / gaming / just-chatting / spicy) shifts presence
**spawn weights** and adds **baseline appeal** per segment, so a cozy niche pulls the
cozy/lonely crowd while spicy pulls simps/whales (and pushes cozy away). Switching costs
a small follower hit + a freshness reset. Picked from the offline ActionBar
"🗓 schedule board".

## Novelty & burnout (`BALANCE.novelty`, `events.ts`)
Per-content **freshness** (`store.contentNovelty`, keyed by niche) drains
`drainPerRepeat` (0.18, floor 0.4) on each live action and dulls hype/tips/follower
gain; rest + variety recover it (`recoverPerRest` on sleep). Chronic low **mood + comfort**
arms a **burnout event** (offline) that forces a rest choice.

## Content tiers (`content.ts`)

| Tier | `tierIntensity()` (chat/stalker gate/ActionBar, local-eval cap) | `controller.intensity()` (presence spawn bias) |
|------|---|---|
| wholesome | 0 (cap 2) | 0 |
| flirty | 1 (cap 3) | 1 |
| risqué | 2 (cap 4) | 2 |
| unhinged | 4 (cap 5) | 3 |
| custom | 4 (cap 5) | 3 |

The tier sets the **ceiling**, not a floor — most content stays ordinary; the tier
just removes the cap. The engine doesn't hard-block actions on content grounds; the
LLM declines in-character at low tiers via the steering text.

> Mismatch: `unhinged`/`custom` map to **4** in the content/chat path but **3** in
> the presence path. See [09](./09-expectation-vs-reality.md).

## One live action, end to end (worked example)

1. Evaluator returns: intensity 3, appeal `{hype:+2}`, pressure `{hype:up}`.
2. Resolver: hype += ~5.4 (pressure); each segment's satisfaction drifts 40% toward
   `50 + appeal×14`.
3. Tips from segments with sat > 55; followers from the weighted-happy formula.
4. Time +8 min (medium) → energy −0.96, hype −0.8.
5. Chat burst of `clamp(round(viewers/6) + 2, 3, 8)` messages reacts.
6. `presenceTick` reshapes who's online and the segment populations.
7. 28% chance a random event fires.
