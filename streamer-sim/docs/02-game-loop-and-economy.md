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
| `subscribers` | ≥ 0 int | **1** | Tracked & goal-rewarded. **No recurring sub income is implemented.** |
| `currentViewers` | ≥ 0 int | **0** | Live viewer count (display). |
| `peakViewers` | ≥ 0 int | **0** | **Lifetime** peak (used by the 100-viewers goal). |
| `hype` | 0–100 | **20** | Momentum; decays while live; drives tips/spawns. |
| `energy` | 0–100 | **100** | Stamina; drains while live; full reset on sleep. |
| `mood` | 0–100 | **70** | Wellbeing. |
| `comfort` | 0–100 | **90** | Boundary/parasocial pressure. Low comfort "feeds" stalkers. |
| `day` | int ≥ 1 | **1** | In-world day counter. |

`patchMetrics` clamps hype/energy/mood/comfort to 0–100 and updates
`peakViewers = max(peakViewers, currentViewers)`.

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
clock   = 8:00 pm
```
Warns if cash goes negative. (No bankruptcy/eviction loss exists yet.)

## The economy

### Tips (live actions, in `resolver.ts`)
For each segment with `satisfaction > 55` and `population > 0`:
```
tip += ((sat − 55) / 45) × tipFactor × population × 0.12 × mult.income
```
Segment `tipFactor`: hype 0.8, lonely 1.1, simps 1.6, trolls 0.2, cozy 0.9,
**whales 5.0**, stalkers 1.2.

### Follower gain (live actions, `resolver.ts`)
```
satWeightedHappy = Σ over happy segments: ((sat − 55)/45) × growthFactor × population
reach            = 0.4 + min(1.8, followers / 500)
gainedFollowers  = max(0, round(satWeightedHappy × 0.18 × reach))
```
Segment `growthFactor`: hype 1.3, lonely 1.0, simps 1.1, trolls 0.6, cozy 1.0,
whales 0.4, stalkers 0.5.

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

A message from a **named character** also grants **+0.6 affinity** (cap 100),
increments their `messageCount`, and logs any tip to them.

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

> **The resolver never changes segment *population*.** Populations are entirely
> presence-driven (see [03](./03-social-systems.md)). The comment in `segments.ts`
> about unhappy segments "shrinking and leaving" is **not implemented**.

## Actions

`ActionVerdict` (`actions.ts`): `plausible`, `tags` (from a closed set of ~29),
`intensity` 1–5, sparse `appeal` per segment (−3..3), `pressure` (up/down/none on
each stat), `narration`, optional `setsBoundary`. `PlayerAction` carries the text, a
`source` (`freeform | menu | furniture`), and an optional hint.

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
| 1080p-cam | $260 | viewer ×1.25 |
| green-screen | $150 | income ×1.15 |
| gaming-chair | $200 | moodPerDay +4 |
| plant-wall | $130 | moodPerDay +3, viewer ×1.05 |
| soundproofing | $180 | moodPerDay +3 |
| loft-apartment | $1500 | viewer ×1.3, income ×1.1, **rentPerDay +25**, moodPerDay +5 |

With everything owned: viewer ×1.51, hype ×1.16, income ×1.32, moodPerDay +15.

> **`mult.viewer` is computed but never read** — nothing in the resolver or presence
> uses it, so camera/gear upgrades currently have **no effect on viewer counts**.
> Only `mult.hype`, `mult.income`, `mult.moodPerDay`, and `mult.rentPerDay` actually
> do anything. See [09](./09-expectation-vs-reality.md).

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
