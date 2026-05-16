---
name: npcs
description: Schema and rules for creating NPCs
context: fork
agent: npcs
---

# NPCs

Read canon from `tabs/npcs.json`. Write proposals to `candidates/npcs.json` (top-level key: `npcs`). The runtime contract for fresh NPCs (base `generateNPCDetails` + Sephii's Enhanced NPC Details + Hedoria NPC Register mod) prescribes a 4-block hiddenInfo, distinctive basicInfo, and the personality format below — author NPCs in the same shape so the runtime sees consistent format whether the NPC was generated or pre-authored.

## Required Fields

| Field | Requirement |
|-------|-------------|
| `name` | Must match object key exactly |
| `type` | Use existing npcType when it fits, otherwise `""` for unique NPCs |
| `currentLocation` | Use a fitting existing location, or invent one |
| `currentArea` | Use `""` if not relevant, or a valid area from the location |
| `gender` | Always set. Mostly male and female. Characters of unusual gender expression where their species or personal history calls for it (Molvar are biologically genderless; individual humans whose lives left them outside the usual). |
| `basicInfo` | Distinctive prose — see format below. The full basic character sheet: identity, personality, background context, AND combat behavior. Everything observable about the character lives here |
| `visualDescription` | One prose line, two terse sentences — see format below |
| `hiddenInfo` | Two labeled blocks: Desire, Secrets — see format below. Only what is actually hidden. Minimal but salient |
| `abilities` | At least five appropriate abilities |
| `tier` | Always set to `mythic` for combat NPCs (determines intent complexity) |
| `level` | Always set — each level adds +1 to damage output |
| `hpMax` | Always set — see HP guidelines below |
| `known` | Always set to `true` |
| `voiceTag` | Voice tag for speech synthesis (see [voice-previews](references/voice-previews/voice-previews.md)) |

## Conditional Fields

| Field | When to Include |
|-------|-----------------|
| `faction` | Only for major plot-relevant faction membership |
| `aliases` | Include when NPC is commonly referred to by title, epithet, or nickname in the story. Only list exact strings the narrator or other NPCs would literally speak |

## Never Include

Omit these fields (auto-set, unused, or absorbed elsewhere):
- `personality` — public personality descriptors now live in `basicInfo`; the hidden detail still lives in `hiddenInfo`'s Personality block
- `vulnerabilities`, `resistances`, `immunities`
- `visualTags`
- `detailType`, `hpCurrent`, `activeBuffs`
- `currentCoordinates`, `embeddingId`, `embedding`, `portraitUrl`
- `properName`, `status`, `relationship`, `lastSeenTick`
- `lastSeenLocation`, `lastSeenArea`, `playerNotes`
- `needsDetailGeneration`, `deathXPAwarded`

## basicInfo Format

**High-signal keyword phrases, not prose.** Comma-separated `[modifier] [noun]` fragments. The runtime LLM in Voyage fleshes out scenes from your hooks — your job is dense signal, not authored narrative. No subject-verb-object sentences. No closing summaries. No flowing description. Pack the hooks; let runtime fill them. The sheet must be **portable** — generic enough to slot into any party scene, not welded to a single location through narrative description.

Each sub-section is a stream of phrases, comma-separated. Sub-section labels (`Identity:`, `Personality:`, `Background:`, `Combat:`) help the LLM parse.

*Identity:* [occupation], [age], [race], [current public role or establishment], [one distinctive physical hook — asymmetry, sensory specific, how they hold a thing], [race-specific physiology where unusual], [carry/wear identifier; name specific items if load-bearing in `tabs/items.json`]

*Personality:* [default manner], [what changes under pressure], [social calibration], [deflection or openness], [one real competence], [one low-stakes tic]

*Background:* [current situation as hook], [one local relationship as hook], [active want], [strong stance or opinion]

*Combat:* [style + range], [escalation/withdrawal cue], [one signature tactical habit]

**Target: 40-80 words total** across all four sub-sections. If a clause has subject-verb-object-narration shape, rewrite as phrase fragments. If a phrase welds the character to one location (encyclopedic-knowledge-of-X-corridors, knows-every-rotation-of-the-Y-guard), generalize it (palace-insider, guard-savvy). Active wants only; no closed "settled, no longer seeks" non-states; no internal feelings the player cannot see (no "what surfaces in his mind", no "the calm itself solves problems"). Historical relationships are one token only (widowed / divorced / never-paired).

(Race-specific physiology cues where unusual: Draklid horn-spread, Hofnar mane-cycle-tally, Vorok tusk-character, Threshi chitin-coloration, Cephalen scalp-tentacles, Fernwarg mane-trophy, Raknid pale-silk mantle, Prime relic-display, Molvar root-coloration.)

## visualDescription Format

**One prose line: two terse sentences built from phrases and a short race description.** Covers what a player sees on approach — their general racial appearance (depending on race) build, colouring, clothing, one memorable detail. Not a portrait; a silhouette with one sharp hook. Sentence fragments and noun-phrases are fine; full narrative is not. Target: 15-30 words total.

First sentence: body shape, colouring, race cues. Second sentence: clothing/gear plus one sensory-specific detail that makes this NPC visually distinct from any other.

## hiddenInfo Format

Two labeled blocks in this order: **Desire, Secrets**. Everything observable — identity, personality, background, combat — lives in `basicInfo`. hiddenInfo holds only what is actually hidden until the right scene surfaces it.

Format: `"Desire: ...\n\nSecrets: ..."`

**Minimal but salient. Keyword phrases, not prose.** Comma-separated `[modifier] [noun]` fragments. Both blocks are read by an LLM at play-time, not by a human; pack signal, do not narrate. No subject-verb-object sentences. No restating of facts already in `basicInfo`. Cut anything that does not earn its place — if a phrase would not change what the character does in a scene, it does not belong.

**No formulaic phrasings repeated across the roster.** Each NPC's content must read distinctively. If two NPCs would have used the same opener or the same "resigned old person" shape, both are wrong — rewrite. Watch especially for recycled Desire formulas ("old and past the age where he seeks partnerships", "absorbed in her work and content with this", "does not require emotional intensity").

**Every block must give the runtime LLM something the player can interact with.** Describe active wants — what the character is currently pursuing, what they would say yes to, what they are doing right now. "Settled, content, no attachments, no interest" is a non-state; the player can do nothing with it. Internal feelings the player cannot see — old griefs, private memories, people they still think about — are also non-states; the LLM cannot surface them as gameplay.

**Historical relationships get a one-word footnote at most** (widowed, divorced, never-paired). Do not elaborate on past partners, old loves, or losses. Describe the active present instead.

### Desire — keyword phrases, not prose

Format: comma-separated phrases. **Name the drives plainly and explicitly.** No euphemisms, no sanitising, no coy indirection. Use direct terms: sexdrive, submissive, voyeuristic, predatory, breeding-fixation, pain-seeking, etc. Taboo desires (incest-adjacent fixations, power-abuse arousal, bestiary-curiosity, corruption kinks, age-gap hunger, ownership fantasies) are valid dimensions — include where they fit the character without moralising or special emphasis. Treat them as another trait, not a spectacle.

No "what surfaces now is..." narrative constructions. No past-partner counts or stories. Widowed / divorced / never-paired is the only past-relationship token allowed.

Pick **2-4 dimensions** per NPC and write each as a terse phrase:
- **Sexdrive** (near-asexual / low / moderate / high / insatiable / compulsive; most are not "moderate" — pick a side)
- **Orientation** (narrow / broad / shifting / exclusively-X)
- **Kinks or fetishes** (most characters have at least one — name the shape plainly: an act, a partner-category, a dynamic, a power-configuration, a bodily fixation)
- **Pursuit style** (predatory / transactional / romantic / opportunistic / passive-receptive / coercive / seductive / manipulative)
- **History shape** (one word: unremarkable / scandalous / mercenary / monkish / traumatic / late-bloomer / political / abusive / exploitative)
- **Active pursuit or specific opening** (who they're after, conditions for yes, what they refuse now; for monkish/low-drive characters, the specific exception phrase)
- **Survivor / witness / complicit / perpetrator / profiteer texture** where history demands it (bestiary predation, magic-trade extraction, Quelled trade, captive-camps)

**Target: under 25 words.** Phrase fragments only, comma-separated.

**Forced variance across the roster.** No two NPCs should land on the same dimension-combo. If the previous NPC was "broadly open, no kinks, moderate sexdrive", this one is not. Range across the full roster: monkish → uncomplicated → kink-specific → insatiable → mercenary/transactional → traumatic-with-specific-key → exclusively-particular → taboo-driven → predatory.

**Never the "no longer seeks anyone" pattern.** Even low-drive, monkish, or traumatized characters need a specific texture — a vow with a specific exception, a sexdrive that wakes for a particular kind of partner, a transactional door, a body that responds to one trait only. Past relationships still get one-word footnotes (widowed, divorced, never-paired); the active present always has shape.

### Secrets — keyword phrases, not prose

Format: comma-separated specific facts. **2-4 secrets per NPC is the norm.** Only write `"None"` for genuinely transparent characters (rare — most people are hiding something).

Each fact must be specific enough that the runtime LLM can surface it in the right scene. Vague "carries shame" / "old guilt about the past" is a non-secret — cut. Phrase fragments only, no narrative explanation of how it came to be.

**Target: under 30 words** across all secrets.

Draw from the full range — nothing is off-limits:
- [Past crime: murder, theft, arson, poisoning, fraud]
- [Forbidden liaison: affair, incest, cross-species, with an enemy]
- [Hidden allegiance or double-dealing]
- [Active lie or false identity they maintain]
- [Addiction: substance, gambling, sexual compulsion]
- [Debt, blackmail leverage held or owed]
- [Illegitimate children, secret heirs]
- [Betrayal: sold out a friend, collaborated with an enemy]
- [Knowledge they shouldn't have: witnessed a crime, knows a weakness, overheard a plot]

## abilities Format

At least five appropriate abilities.

**Format: name-only references to entries in `tabs/abilities.json`.** Each string must exactly match an existing ability's `name` field. The runtime resolves name → full description at play-time.

```json
"abilities": ["Tracker's Patience", "Beast-Snare", "Plant Whisperer", "Hardened to It", "Pass Unseen"]
```

Run `node .claude/scripts/block-tool.js keys abilities abilities` to see the full catalogue. Match abilities to the NPC's role and combat capacity. Combat characters get combat abilities; civilians get utility abilities. Never silly, never technological or scientific.

**Never write inline `"Name: description"` prose.** That fragments the catalogue and blocks reuse — the same convention as `traits.<trait>.abilities`, which has always been name-only references.

If an NPC's identity calls for an ability the catalogue lacks, **add the new ability to `tabs/abilities.json` first** (full schema entry: name, description, requirements, bonus, cooldown), then reference it by name from the NPC.

The combat philosophy and tactical signatures live in the **Combat block of hiddenInfo**, not in a fighting-style summary inside the abilities array.

## level & hpMax Calculation

Players start with 100 HP and deal ~16 damage on success.

- **level**: Determines NPC damage. Calculate hits to down player: `100 ÷ (16 + level)`
- **hpMax**: Determines NPC survivability. Calculate hits to down NPC: `hpMax ÷ 16`

## Schema

```typescript
interface NPC {
  name: string
  type: string
  currentLocation: string
  currentArea: string
  tier?: 'trivial' | 'weak' | 'average' | 'strong' | 'elite' | 'boss' | 'mythic'
  gender?: string
  faction?: string
  visualDescription?: string
  basicInfo?: string
  hiddenInfo?: string
  abilities?: string[]
  level?: number
  hpMax?: number
  known?: boolean
  voiceTag?: string
  vulnerabilities?: string[]
  resistances?: string[]
  immunities?: string[]
}
```

## Species Ability Inheritance

When creating an NPC with a species `type`, the NPC should **inherit the species abilities** from the corresponding trait:

1. Look up the species in `tabs/traits.json`
2. Copy the **names only** from the trait's `abilities` array into the NPC's `abilities` array
3. Add additional ability references specific to that individual, chosen from `tabs/abilities.json`

The combat philosophy goes in `hiddenInfo`'s Combat block, not in abilities.

See [Species Consistency Rules](../species-rules.md) for the full requirements.

## Reference

For detailed documentation, see [npcs-reference.md](references/npcs-reference.md).
