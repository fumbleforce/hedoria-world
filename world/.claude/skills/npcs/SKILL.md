---
name: npcs
description: Schema and rules for creating NPCs
context: fork
agent: npcs
---

# NPCs

Read canon from `tabs/npcs.json`. Write proposals to `candidates/npcs.json` (top-level key: `npcs`). The runtime contract for fresh NPCs (base `generateNPCDetails` + Sephii's Enhanced NPC Details + Hedoria NPC Register mod) prescribes a 4-block hiddenInfo, distinctive basicInfo, and the personality format below — author NPCs in the same shape so the runtime sees consistent format whether the NPC was generated or pre-authored.

## Hard Rules

- **Magic-user sterility.** Witch and wizard NPCs (the human gendered system) cannot biologically reproduce. The act of channeling or generating mana unmakes that capacity — the body that holds and moves the world's living power does not also produce its own life.

## Required Fields

| Field | Requirement |
|-------|-------------|
| `name` | Must match object key exactly |
| `type` | Use existing npcType when it fits, otherwise `""` for unique NPCs |
| `currentLocation` | Use a fitting existing location, or invent one |
| `currentArea` | Use `""` if not relevant, or a valid area from the location |
| `gender` | Always set. Mostly male and female. Characters of unusual gender expression where their species or personal history calls for it (Molvar are biologically genderless; individual humans whose lives left them outside the usual). |
| `basicInfo` | Distinctive prose — see format below |
| `personality` | Comma-separated mix per format below |
| `hiddenInfo` | Four labeled blocks: Background, Personality, Desire, Combat — see format below |
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

Omit these fields (auto-set or unused):
- `vulnerabilities`, `resistances`, `immunities`
- `visualDescription`, `visualTags`
- `detailType`, `hpCurrent`, `activeBuffs`
- `currentCoordinates`, `embeddingId`, `embedding`, `portraitUrl`
- `properName`, `status`, `relationship`, `lastSeenTick`
- `lastSeenLocation`, `lastSeenArea`, `playerNotes`
- `needsDetailGeneration`, `deathXPAwarded`

## basicInfo Format

Lead with what they do or what is wrong with them, not a "[gender] [race] [role]" template. Include a distinctive physical feature — an asymmetry, the wrong detail, a sensory specific (smell, voice texture, the way they hold a thing). Race-specific physiology should be included where unusual or specific: Draklid horn-spread and tail-marking, Hofnar mane-shape and clan-cycle-tally, Vorok tusk-character and house-sigil placement, Threshi chitin-coloration and wing-panel pattern, Cephalen scalp-tentacle arrangement, Fernwarg mane-trophy weave, Raknid pale-silk mantle, Prime relic-display, Molvar root-coloration. End with what they wear or carry that signals identity. If the NPC is publicly known for a specific item — a named weapon, a specific worn object — name it; that item should also exist in `tabs/items.json` when load-bearing.

## personality Format

A comma-separated list mixing adjectives, descriptive phrases, and behavioral notes.

Include:
- External manner — how they come across to strangers
- Internal drive — what they actually want
- A contradiction or complexity — something that cuts against the grain
- A weakness, hidden or visible

Don't include:
- Verbal tics or catchphrases
- Sitcom-style mannerisms or twee repetitions

Personality must not restate, reflect, or derive from profession or role. The job is what they do; personality is how they do it, why they do it, and who they are when they're not doing it.

## hiddenInfo Format

Four labeled blocks in this order: **Background, Personality, Desire, Combat**.

Format: `"Background: ...\n\nPersonality: ...\n\nDesire: ...\n\nCombat: ..."`

### Background — 8-10 sentences

Cover all of:
- Name, age, race, occupation, how they earn their living
- How they arrived at their current situation — what is unresolved or still affecting them. Not a full biography
- At least one local relationship — someone who could be referenced in conversation. Describe the dynamic ("resents the guild clerk who denied her application"), not the fact ("knows a guild clerk named Tamsin")
- What they currently want or care about. Can be mundane, satisfied, contradictory, or self-interested
- One or two opinions about the world — their faction, local authority, neighbors, recent events, the kind of people they deal with

### Personality — 9-11 sentences

Cover all of:
- How they talk — sentence length, vocabulary, verbal habits, favorite expressions; what makes them talkative versus terse
- Default social behavior AND what changes it — pair these. "Friendly and familiar with everyone by default, but turns sharp and transactional when she thinks someone is wasting her time"
- Low-stakes behavior — what they do when idle, small things they enjoy, what they complain about
- Social calibration — how they treat people above, below, or equal in status; whether they adjust or treat everyone the same
- What they deflect or lie about, if anything. Many characters are simply open, blunt, or indifferent — not everyone hides
- One area of real competence or strong conviction

Equal space across these points. Do not let any single detail dominate.

### Desire — 4-6 sentences

The character's private life and what they want bodily. Cover what fits this character; not all dimensions apply to every NPC:
- Orientation and experience — broad, narrow, or shifting. Many characters are open or roughly so; bisexual or all-comers is common; narrow specificity is character-specific, not the default
- What draws them — could be a general trait (kindness, stamina, wit, danger, station, scars), a kind of company, a particular act, or none in particular. Not every character has a strong "type"; many just want good company
- A line they will or will not cross — what they refuse, what they have never done, what they have done once and regret
- Where the character's history calls for it: survivor / witness / complicit / perpetrator / profiteer texture with the bestiary's predation, the magic-trade extraction, the Quelled trade, captive-camps. Not for every NPC; never sanitized from characters whose history carries it

Range: open and uncomplicated → transgressive → tortured → political/transactional. Never blank, but openness is fine content — "drawn to good company, doesn't worry about the rest" is a valid Desire block.

Keep partners grounded in the character's current life — current company, recent encounters, possibilities they imagine. Avoid the distant-lover-in-another-region pattern.

### Combat — 5-6 sentences

Cover all of:
- Fighting style, aggression level, preferred range
- What makes them start, escalate, or abandon a fight; how they react when wounded
- One tactical habit or signature behavior that makes their combat feel distinct
- Combat-trained characters fight like it; civilians react to violence consistent with their background — panic, submission, reckless aggression, desperate resourcefulness

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
  basicInfo?: string
  hiddenInfo?: string
  personality?: string[]
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
