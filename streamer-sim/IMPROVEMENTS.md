# Limelight — Improvement Backlog

A long menu of possible directions, grouped by theme and tagged with rough
effort (S/M/L) and whether it leans on the LLM. Nothing here is committed — it's
for you to pick from. Items marked ⭐ are the ones I'd reach for first.

---

## DONE: Event Director & interactive scenes (2026-05)

Replaced ambient `rollEvent` with an LLM **Event Director** (`eventDirector.ts`)
that composes a typed **capability vocabulary** (`EventEffect`) from live state +
signals. Delivery modes:

- **Scene** — multi-beat loop in the narrator feed (ActionBar "⚡ In the moment");
  resolve applies big consequences via `applyEventEffects`.
- **Notice** — one beat + immediate effects (passive path).

Hardcoded raises retired (stalker-confront force-roll, milestone modals, burnout
modal, 28%/40% rolls). Follow-ups use `pendingEventSeeds` instead of `ARC_DEFS`
chains. Consequences surface through the feedback layer.

Follow-ups (2026-05, post-review):
- **Dead code removed** — deleted `arcs.ts`, the `arcs` store slice, `maybeStartArc`,
  and the `StoryArc`/`ArcKind` types + GoalsPanel "story threads" UI (the director
  supersedes them). Dropped the unused `masteryLevelsFor` export.
- **`incomingDm` capability** — events that narrate a private message now land a real
  DM in the inbox (`pushDm` + unread + notify) instead of just describing one. The
  director supplies the *gist* (`charRef` + `note`); the sender then writes the line
  itself via `composeIncomingDm`, so voice + what they reveal stays in-character.
- **NPC self-knowledge & natural reveals** — every character is seeded with a
  persistent `realName` (and `characterVoiceBlock` now feeds their whole self into
  NPC-voice prompts) with the rule to share only what fits the relationship and to
  never censor (no `[Redacted]`). The player learns facts the natural way — the
  relationship milestone exposes `realName`, or the NPC volunteers it and the DM
  director emits a structured `reveal`. No forced/regex reveals; all paths resolve to
  the same consistent `realName`.
- **Scenes pass time slowly** — each beat advances the clock by
  `BALANCE.events.beatMinutes` (2 min) so events breathe without burning the night.

Files: `eventDirector.ts`, `controller.ts` (`maybeTryDirectorEvent`,
`applyEventEffects`, scene loop), `balance.ts` (`BALANCE.events`), `store.ts`
(`eventScene`, `pendingEventSeeds`), `ActionBar.tsx`.

---

- ⭐ **Conversation memory for live chat** (M, LLM). Chat bursts currently see the
  last ~6 lines. Give the chat model a rolling summary of the whole stream so
  running jokes, callbacks, and "remember when" moments emerge.
- ⭐ **Per-character voice consistency** (M, LLM). Pass each named regular's recent
  lines so their personality stays stable across the night, not just per-burst.
- **Streaming responses** (M, LLM). Stream tokens so chat/DMs appear progressively
  instead of in a blocking lump — feels far more alive.
- **Two-tier model routing** (S, LLM). Use a cheap/fast model for chat bursts and a
  stronger model for the evaluator, event narration, and DMs. Configurable.
- **Structured tool-calling for the evaluator** (M, LLM). Use the provider's native
  JSON/function-calling instead of "respond with JSON" + parse, eliminating the
  fallback path entirely on capable models.
- **Prompt-tuning surface in Settings** (S). Live token/latency counters per call
  kind; a "last raw response" viewer so you can debug prompts without the logfile.
- **Retry-with-repair** (S, LLM). On an unparseable verdict/chat, do one cheap
  "return ONLY valid JSON" retry before falling back to the local engine.

- **Self-consistency for the evaluator** (M, LLM). For high-impact actions, sample
  the verdict twice and reconcile, so a single odd classification can't swing the
  economy.

## DONE: 2. The viewer cast (deepen the named characters)

- ⭐ **Stalker escalation arcs** (L, LLM+code). Promote a stalker from chat → DM →
  door → real-world threat across days, gated by comfort and your choices. A named
  antagonist with a multi-day storyline and a resolution (block, report, confront,
  move).
- ⭐ **Relationship milestones** (M). Crossing affinity thresholds fires a scripted
  beat: a regular reveals their name, a whale offers patronage, a soft admirer
  confesses. Makes "getting to know" people pay off.
- **LLM-authored character backstories** (M, LLM). On first appearance (or when you
  open their sheet), generate a richer bio, avatar prompt, and quirks beyond the
  archetype seed.
- **Character portraits** (M, LLM-image). Generate a small avatar per named viewer;
  cache it. (Pairs with the image work in §6.)
- **Cross-stream continuity** (M). "lonely_mara was here 3 streams in a row" — track
  attendance streaks; absences become noticeable and meaningful.
- **Rivalries & chat dynamics** (L, LLM). Characters react to *each other*, not just
  to you — trolls bait simps, mods clap back, a ship forms between two regulars.
- **Reputation/word-of-mouth** (M). Happy named regulars "bring friends" (spawn new
  characters of a compatible archetype); angry ones leave reviews that dent growth.

## DONE: 3. Events & story (variety and consequence)
- **Rework events** (M). The current events are just annoying and static. Rework them to use LLM generation, be genuinely interesting, and allow freeform responses depending on what the event is. Random noise like technical issues or troll intrustion is not interesting.
  recur back-to-back; reference past events in narration ("after last week's raid…").
- ⭐ **Multi-step event chains** (L, LLM+code). Events that span turns/days: a brand
  deal becomes a sponsorship arc; a stalker becomes a police report; a viral clip
  becomes a follower surge then a backlash.
- **Event cooldowns & memory** (S). Track recent events so the same beat doesn't
  recur back-to-back; reference past events in narration ("after last week's raid…").
- **Real-life intrusion events** (M, LLM). Landlord visit, a sick day, 
  a power cut mid-stream — the "life" half of "life sim".
- **Seasonal / dated content** (S). Holiday streams, anniversary of going live,
  birthday donations — uses the in-world calendar.
- **Goal/quest layer** (M). Soft objectives ("hit 1k followers", "survive a month's
  rent", "go full-time") with payoffs, giving the sandbox a spine.

## DONE: 4. Game systems & economy

Delivered by the **Affinity & Economy Overhaul** (centralized `game/balance.ts`,
the `applyAffinity` ledger, resolver readiness gating, the feedback-bubble layer,
domain mastery, and the systems below). See `docs/02`, `docs/03`, `docs/08`.

- ✅ ⭐ **Economy balance pass** (M, code). Tip/follower/rent curves retuned via
  `BALANCE.economy` into a slow early game: lower `tipConstant`, a monetization ramp
  (`min(1, followers/150)`), a recurring utility bill, and readiness gating so payoff
  depends on audience fit + comfort/energy/hype. `mult.viewer` is now wired into
  presence so gear grows the audience.
- ✅ **Schedule & burnout** (M). Per-niche novelty drains on repeats and recovers with
  rest (dulls hype/tips/followers when stale); chronic low mood + comfort arms a
  burnout event.
- ✅ **Sub tiers & recurring income** (S). `payRecurringSubs` pays
  `subscribers × $3.5 × mult.income` on a 30-day cadence — predictable income vs. tips.
- ✅ **Outfits as real items** (S). Worn outfit (`settings.outfit`) applies passive live
  appeal nudges (cute→hype/simps, bold→simps/whales & comfort cost, cozy→cozy/lonely).
- ✅ **Content niches & schedule board** (M). Offline `NichePicker` sets a niche that
  shifts presence spawn weights + baseline appeal; switching costs a follower hit +
  freshness reset.
- ✅ **Equipment progression depth** (S). New camera tiers + themed décor add
  `productionQuality` (global appeal/viewer pull) and `segmentAppeal` (targeted crowd
  pull + spawn bias).

> **Adjacent, still open:** affinity is now effort-gated, but there's no
> win/lose/eviction state, and the difficulty arc targets in `docs/02` are proposals
> to validate by playtest.

## DONE: 5. The "playing a game" + other sub-states
- **Generic sub-state engine**, like the event/meet engine, where we are actively doing some activity over longer periods of time. It could be things like reading a book aloud, masturbating on cam, anything in between. Engagved via a start activity menu like for actions, with some pre-filled options plus a custom option. 
- **Activity story** (M). While playing, we get a more detailed narration during the current activity
- **Game-specific chat & events** (S, LLM). Backseat gamers during FPS, scream-clip
  requests during horror, route-voting during a dating sim.
- **Game library as purchases** (S). Buy/unlock games from the shop; some please
  niches you're trying to grow.


## 6. Graphics & presentation
- ⭐ **The occasional "stream cam" image** (M, LLM-image). Your original ask: at
  notable beats, generate a tasteful framed image of the current moment (tier-gated)
  and drop it into the narrator feed. Taken from the Camera perspective.
- **Day/night lighting** (S). Tint the room with the in-world clock — warm evening
  → cool late-night — so time is felt, not just read.
- **Stream-overlay framing** (S). Render the cam feed as an actual stream layout
  (webcam box, alerts, recent-follower toast) for theme.
- **Animated metric/alert toasts** (S). Follower/sub/tip alerts slide in like a real
  stream, with sound.

## 7. Audio

- **Ambient + music beds** (S). Lo-fi for cozy, tension for horror, a hum of "room
  tone"; ducks during events.
- **SFX** (S). Tip cha-ching, follower pop, door knock, DM ping, keyboard clatter.
- **TTS for the streamer / DMs** (M, LLM-audio). Optional voiced lines.

## 8. UX & quality of life

- **Onboarding / first-run** (S). A 30-second guided first stream so the loop is
  legible without reading docs.
- **Action history & undo-free clarity** (S). A collapsible "what changed" panel per
  action (already logged — surface it in-game).
- **Keyboard-first play** (S). Hotkeys for Continue, Banter, Bit, End; number keys
  for menu options.
- **Mobile/responsive layout** (M). The three-column grid needs a stacked mode.
- **Accessibility** (M). Reduced-motion, font scaling, colorblind-safe segment
  colors, screen-reader labels on the SVG.
- **Pacing controls** (S). A speed slider for ambient chat cadence; pause.

## 9. Content authoring & moddability

- **Data-driven archetypes/events/games** (M). Move the catalogues to JSON so you
  (or players) can add archetypes, events, mini-games, and upgrades without code —
  mirrors the Hedoria pack pattern.
- **Content packs / themes** (L). Swap the whole flavor (vtuber, cam-girl, cozy
  artisan, podcast host) via a pack.
- **Custom steering presets** (S). Saveable named steering profiles beyond the single
  "custom" box.

## 10. Technical & infra

- **Real persistence beyond localStorage** (M). IndexedDB (Dexie, like Hedoria) for
  large rosters, transcripts, and generated images.
- **Production LLM proxy** (M). The current OpenRouter proxy is dev-only; a deployable
  serverless proxy would let this ship without exposing keys.
- **Automated tests** (M). Unit-test the resolver/economy and the JSON extractor;
  snapshot the evaluator's local rules. Guard the math from regressions.
- **Telemetry/debug HUD** (S). An in-app overlay of the last N diag events, toggled
  with a hotkey, so you don't need the console or logfile.
- **Deterministic seeded mode** (S). Seed the RNG for reproducible playthroughs when
  debugging balance.

---

## 11. Cameras, items, gifts & set design
- ⭐ **Camera placement as a system** (M, code+UI). You can only go live from a
  zone that has a camera. The streaming desk has the built-in cam; other zones
  (couch, bed, kitchenette, bathroom) require a camera placed there. Going live
  from the kitchen should be impossible without a **portable cam** item.
- **Portable camera item** (S). A purchasable item you carry; lets you go live
  from whatever zone you're standing in (lower quality than a fixed rig).
- **Multiple cameras = multiple angles** (M). Buying and placing additional
  cameras gives chat extra views/angles of the studio. Surface a "cam switcher"
  (Desk Cam / Room Cam / Couch Cam…); the active angle flavors narration and
  which zones are "on screen". More angles = production value = a viewer/hype bump. We should make it so that we can only start streams form the computer if we only have the starter webcam. to sream for the sofa, we need more cams. Can also place cam in kitchen, bathroom (spicy) and bed (spicy). We should be able to generate cam footage from these locations. chat must be aware of these locations, and where the player is.
- **Camera quality tiers** (S). Webcam → 1080p → DSLR rig; each placeable, each
  affecting viewer pull and which segments you attract — ties into the existing
  gear shop.
- **"Off-camera" actions** (S). When live, doing something in a zone with no
  camera is private (no audience reaction) — useful for ducking out of view
  deliberately, and a natural tension with parasocial viewers wanting to see more.
- **robust item system** should be able to handle generated new items, add clothes shopping, clothing into inventory
- **character clothes** we should be able to define clothing, what is on and what is not, and narrate taking things on and off.
- **gifts** NPCs can (rarely) send you gifts, either already defined items, or totally arbitrary items you can use, as a capability.


---

## 12. Follow-ups from completed work (§1, §3)

Known limitations / judgment calls left behind after implementing the LLM
harness (§1) and the events overhaul (§3). None are bugs; they're the seams
worth revisiting.

### From §1 — LLM harness
- **Streaming only covers DMs** (M, LLM). Live chat is JSON-mode (a parsed array
  of messages), so it isn't token-streamed; only 1:1 DMs type out progressively.
  Streaming the narrator/story prose is the natural next target.
- **OpenRouter streaming isn't wired** (S). The dev proxy forces `stream:false`,
  so OpenRouter DMs fall back to a single chunk; only Gemini streams for real.
  A streaming-capable proxy would close the gap.
- **OpenRouter structured output is `strict:false`** (S). The evaluator's JSON
  schema is sent with `strict:false` to avoid 400s on optional fields, so it's
  best-effort there (Gemini gets a real `responseSchema`). Tightening the schema
  to be strict-compatible (all-required + `additionalProperties:false`) would let
  us flip it on.

### From §3 — events & story
- **Sponsorship "Push for more" gamble resolves at build time** (S). The random
  payout is baked when the event renders, not when the player clicks. Move the
  RNG into resolution so the gamble is honest.
- **Seasonal occasions are passive** (M, LLM). Holidays/birthday/anniversary
  apply a tip-and-hype tailwind plus a narrated line, but aren't interactive
  themed events. A Halloween costume-choice event, NYE countdown, etc. would be
  richer.
- **Arc beats only fire at day boundaries** (M). Due arc stages surface at
  go-live / sleep, never mid-stream. Matches "span days", but a long multi-day
  stream won't see an arc beat until the next boundary.
- **Only three arcs exist** (S each, LLM+code). The arc engine is data-driven, so
  new chains are cheap: e.g. "collab invite → joint stream → fallout/friendship",
  "burnout warning → forced break", "merch drop → fulfilment → reviews".
- **`stalker-legal` arc events carry the stalker's `characterId`** (S). They pass
  through `resolveEvent`'s stalker-threat block — harmless today (its choice
  labels don't match the regexes), but a latent coupling to isolate if that block
  grows.

---

## DONE: 13. NPC depth pass — motives, progressive reveal, layered memory

The named cast (`game/characters.ts`) is seeded once and barely deepens after.
A sheet's `vibe`/`wants` are fixed archetype constants; `backstory`/`quirks`
generate exactly once on first open (`controller.generateBackstory`) and never
change again; `memory` is a single ≤180-char line that `condenseMemory`
overwrites on every DM, so history is lost. The modal (`CharacterModal.tsx`)
dumps the *entire* ground-truth sheet the instant you click. The threads below
mostly hang off triggers that already exist (`checkMilestones` for affinity,
`advanceStalkerArc` for threat).

### A. Layered, per-character motives (M, LLM+code)
- ⭐ **Problem:** `wantsForArchetype` maps each of the 7 segments to ONE fixed
  phrase, so *every* simp literally "wants flirty attention and banter" and every
  whale "to be acknowledged by name". Motive is a segment constant, not a person.
- Replace the single `wants` string with a small motive structure on
  `CharacterSheet`: a **surface want** + a **deeper need** + a **fear/insecurity**
  + a **soft boundary**. Seed it with per-character variation (roll within the
  archetype, not a segment constant) and let the LLM enrich it (see C).
- Feeds the DM director, chat voice, and visit scenes so two simps read
  differently; gives the evaluator more to react to than one phrase.

### B. Progressive reveal (player) + dev X-ray (local) (M, code+UI)
- ⭐ **Production view:** a fresh character is **anonymous** — handle only. Name,
  backstory, quirks, true motive, and threat are hidden until *earned*. The sheet
  shows a "what you know so far" view; unknown rows render as locked placeholders
  ("??? — get to know them"), not blanks.
  - Name unlocks at the `regular` milestone (already wired in
    `relationships.milestoneFor`) — keep it.
  - Vibe / surface-want hints surface around `familiar` / after N interactions.
  - Backstory fragments unlock at affinity thresholds + threat steps (see C).
  - The ⚠ Threat row only appears once they've actually crept on you (threat ≥ 1
    via `advanceStalkerArc`), not pre-labelled by archetype.
- **Dev X-ray (local only):** behind `import.meta.env.DEV` (and/or a Dev-tab
  toggle — the Dev tooling already exists in `SettingsPanel`/`controller.dev*`),
  render the full ground-truth sheet inside a **visibly-distinct coloured
  container** ("DEV · X-RAY") *alongside* the gated player view, so you can see at
  a glance what's hidden vs. revealed. Strip it from production builds.

### C. Sheets that deepen over time (M, LLM+code)
- ⭐ **Problem:** `generateBackstory` is one-shot — the bio is identical at
  affinity 35 and 95, and threat escalation never enriches it.
- Store backstory as **ordered fragments** (an array) instead of one string.
  Each crossed affinity level (familiar→regular→friend→confidant) or threat step
  (1→2→3) **appends a new, more intimate/sophisticated layer**, authored by the
  LLM with the *prior* layers + memory as context so it stays consistent and
  escalates rather than contradicting itself.
- Threat layers reveal the darker truth (the creep's real fixation), tying the
  reveal directly to the stalker arc.
- Hook the enrichment into the existing trigger points: `checkMilestones`
  (affinity) and `advanceStalkerArc` (threat) in `relationships.ts`, applied by
  the controller the same way milestones already are.

### D. Real memory / interaction record-keeping (M, code+LLM)
- ⭐ **Problem:** `memory` is one overwritten ≤160-char line (`condenseMemory`),
  so the relationship has no actual history.
- Add a **structured, append-only interaction log** per character: timestamped
  entries for DMs, tips, requests, gifts, visits, milestones, threat changes, and
  name mentions. Most are already emitted globally via `logEvent` — they just
  aren't attributed to the character.
- Keep a rolling condensed `memory` as the *summary*, but build it from the
  recent log entries (mirroring `controller.refreshStreamMemory`) instead of a
  blind two-line merge — richer, and it can cite specifics.
- Surface a scrollable "History with {name}" section in the modal, and feed
  recent entries into the DM / chat / visit prompts for continuity.

### E. Fix repetitive viewer names ("everyone is Mark/Marcus") (S, code+LLM)
- Two culprits:
  1. `generateBackstory` asks the model for *"a plausible first name"* with no
     constraint, so it keeps returning Mark / Marcus / Jake. Either drop LLM
     naming and draw from a curated, de-duplicated pool (extend `DISPLAY_NAMES`
     in `relationships.ts`, currently 18 gender-neutral names), or pass the
     roster's existing names as a do-not-repeat list and ask for a gender mix.
  2. The `chat` prompt lets the LLM invent anonymous usernames, which collapse to
     the same handful of real first names. Steer it toward varied, lowercase,
     handle-style usernames (not real names), and/or pre-supply anonymous handles
     from `anonHandle()` so the model writes the *text*, not the identity.
- Enforce **uniqueness** of revealed `displayName`s within the roster.

### F. More varied handles (S, code)
- ⭐ **Problem:** `makeHandle` draws from each archetype's tiny `nameParts` pool
  (5 fragments) glued to one of ~11 `HANDLE_SUFFIX`es, so a hype-fan is forever
  `pog`/`hype`/`based`/`letsgo`/`champ` + a suffix — the same dozen handles recur.
- Widen the generator: a shared bank of generic word-fragments (nouns, adjectives,
  hobbies, animals, gamer-speak) combined with the archetype's flavour parts;
  more join patterns (camelCase, numbers, leet, doubled words, `_TV`/`xX…Xx`);
  optional digit runs. Aim for combinatorial variety, not a fixed table.
- De-dupe against the live roster so the same handle never appears twice, and so
  a fresh spawn doesn't echo someone already on screen.
- Make handles read as *internet usernames*, distinct from the real-name
  `displayName` (§E) — the two should never look like the same naming scheme.

### G. Characters have a gender (S, code+LLM)
- ⭐ **Problem:** only the streamer has a `gender` (`Settings.gender`); viewers
  don't, so name reveals pull from a gender-neutral `DISPLAY_NAMES` list and the
  DM/chat/narrator/visit prompts have no pronouns to work with — everyone reads
  androgynous and the LLM guesses inconsistently.
- Add a `gender` field to `CharacterSheet`, rolled at `seedCharacter` time (a
  realistic mix, optionally skewed per archetype/segment where it fits the
  fantasy). Persist it; backfill in `normalizeCharacter`.
- Thread it through: name pools become gendered (extend §E), pronouns flow into
  the DM / chat / visit / narrator prompts, and portrait/body image generation
  gets the right cue (today only the streamer's gender reaches image gen).

### H. Richer, more varied archetypes — no two stalkers alike (M, code+LLM)
- ⭐ **Problem:** the 20 `ARCHETYPES` are one blurb + 5 sample lines each, and
  every instance of an archetype is a carbon copy — both stalkers (`creep`,
  `stalker`) share the same `blurb`, `wants`, and line bank, so they feel
  identical. Variety is per-archetype, never per-character.
- **Per-instance differentiation:** at seed time, roll a few modifiers on top of
  the archetype — a trait/quirk axis, an intensity, a backstory hook, a distinct
  obsession (for stalkers: *what* they fixate on and *how* they express it).
  Two stalkers should diverge from the first message. Pairs naturally with the
  layered motives in §A.
- **Broaden the catalogue:** more archetypes and sub-variants per segment
  (especially the thin/edge ones — stalkers, whales, trolls) so the room isn't
  drawn from the same 20 moulds; consider data-driving them (ties into §9
  "data-driven archetypes").
- **Deeper archetype definitions:** richer personality beyond a one-line blurb —
  speech tics, do/don't behaviours, escalation tendencies — so the LLM voice and
  the offline `fromCharacter` mock both have more to work with.

> **Suggested slice for this section:** F + E + G together are the cheap,
> high-visibility identity fixes (varied handles, varied names, gender) — do them
> first. Then B (progressive reveal + dev X-ray) since it reframes the modal.
> Then H + A (per-instance archetype variety + layered motives) and C + D
> (deepening + memory), which share the milestone/threat hooks and the LLM
> authoring plumbing.

---

### Suggested first slice (if you want a recommendation)
1. Economy balance pass (§4) — makes the core loop satisfying.
2. Stalker escalation arc (§2) — the signature feature, ties characters+events together.
3. LLM room background + occasional stream-cam image (§6) — the visual leap you asked about.
4. Relationship milestones (§2) — makes "getting to know people" pay off.
