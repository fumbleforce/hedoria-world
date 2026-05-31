# Limelight — Improvement Backlog

A long menu of possible directions, grouped by theme and tagged with rough
effort (S/M/L) and whether it leans on the LLM. Nothing here is committed — it's
for you to pick from. Items marked ⭐ are the ones I'd reach for first.

---

## DONE: 1. LLM harness & quality (make the AI feel smart)

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

## 4. Game systems & economy

- ⭐ **Economy balance pass** (M, code). Tune tip/follower/rent curves into a real
  difficulty arc; right now it's first-draft numbers. Add a slow early game and
  meaningful money pressure.
- **Schedule & burnout** (M). Streaming the same thing daily decays novelty;
  variety and rest matter; chronic low mood/comfort risks a burnout event.
- **Sub tiers & recurring income** (S). Subscribers pay monthly; build predictable
  income vs. one-off tips, changing strategy.
- **Outfits as real items** (M). Wardrobe choices are owned items with stats
  (cute→hype, bold→simps/comfort cost); unlock/buy more.
- **Content niches & schedule board** (M). Pick a niche (cozy/horror/just-chatting/
  spicy); audience composition shifts to match; switching has churn cost.
- **Equipment progression depth** (S). More gear tiers; visible effect on stream
  quality and which segments you can attract.
- **Save slots + new game** (S, code). Multiple saves, a proper reset, an
  export/import of the JSON save.
- **Win/lose & endings** (M). Eviction (bankruptcy) loss; "go full-time" /
  "quit on your terms" / "burn out" endings.

## 5. The "playing a game" sub-state

- **Actual mini-game feedback** (M). While playing, surface a tiny game-specific
  widget (horror jump-scare meter, FPS K/D, farm day counter) that your actions
  nudge — more than a flavor label.
- **Game-specific chat & events** (S, LLM). Backseat gamers during FPS, scream-clip
  requests during horror, route-voting during a dating sim.
- **Game library as purchases** (S). Buy/unlock games from the shop; some please
  niches you're trying to grow.

## 6. Graphics & presentation

- ⭐ **LLM-generated room background** (M, LLM-image). The option you picked: generate
  a detailed studio render and slot it behind the SVG zone hotspots; regenerate as
  you upgrade furniture/apartment. SVG stays the offline fallback.
- ⭐ **The occasional "stream cam" image** (M, LLM-image). Your original ask: at
  notable beats, generate a tasteful framed image of the current moment (tier-gated)
  and drop it into the narrator feed.
- **Day/night lighting** (S). Tint the room with the in-world clock — warm evening
  → cool late-night — so time is felt, not just read.
- **Stream-overlay framing** (S). Render the cam feed as an actual stream layout
  (webcam box, alerts, recent-follower toast) for theme.
- **Animated metric/alert toasts** (S). Follower/sub/tip alerts slide in like a real
  stream, with sound.
- **Polish pass on the SVG** (S). Nicer furniture, shadows, a rug, plants, props
  that appear as you buy upgrades.

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

## 11. Cameras & set design
- ⭐ **Camera placement as a system** (M, code+UI). You can only go live from a
  zone that has a camera. The streaming desk has the built-in cam; other zones
  (couch, bed, kitchenette, bathroom) require a camera placed there. Going live
  from the kitchen should be impossible without a **portable cam** item.
- **Portable camera item** (S). A purchasable item you carry; lets you go live
  from whatever zone you're standing in (lower quality than a fixed rig).
- **Multiple cameras = multiple angles** (M). Buying and placing additional
  cameras gives chat extra views/angles of the studio. Surface a "cam switcher"
  (Desk Cam / Room Cam / Couch Cam…); the active angle flavors narration and
  which zones are "on screen". More angles = production value = a viewer/hype bump.
- **Camera quality tiers** (S). Webcam → 1080p → DSLR rig; each placeable, each
  affecting viewer pull and which segments you attract — ties into the existing
  gear shop.
- **"Off-camera" actions** (S). When live, doing something in a zone with no
  camera is private (no audience reaction) — useful for ducking out of view
  deliberately, and a natural tension with parasocial viewers wanting to see more.



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

### Suggested first slice (if you want a recommendation)
1. Economy balance pass (§4) — makes the core loop satisfying.
2. Stalker escalation arc (§2) — the signature feature, ties characters+events together.
3. LLM room background + occasional stream-cam image (§6) — the visual leap you asked about.
4. Relationship milestones (§2) — makes "getting to know people" pay off.
