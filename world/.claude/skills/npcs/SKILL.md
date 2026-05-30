---
name: npcs
description: Schema and rules for creating NPCs
context: fork
agent: npcs
---

# NPCs

Read canon from `tabs/npcs.json`. Write proposals to `candidates/npcs.json` (top-level key: `npcs`). The runtime contract for fresh NPCs (base `generateNPCDetails` + Sephii's Enhanced NPC Details + Hedoria NPC Register mod) prescribes a 4-block hiddenInfo, distinctive basicInfo, and the personality format below — author NPCs in the same shape so the runtime sees consistent format whether the NPC was generated or pre-authored.

## First, Build the Character — Then Stop

Before any schema field is touched, build the character on paper in five ordered steps. Append the result to `candidates/npcs-stories.md` — one `## <NPC Name>` heading per character, the five sections beneath, `---` separator between entries.

The order matters. Each step constrains the next: canon constrains the archetype, the archetype shapes the race and age, race and age shape the backstory, the backstory shapes the personality. Do not reorder or skip.

### 0. Ground in canon

Before choosing an archetype, read what the world already says about this character's race, profession, and station. Mandatory consultation:

- `.claude/skills/species-rules.md` — race-specific personality and cultural cues
- The race's lore document for any non-human character (file IDs in the project root CLAUDE.md under "Deeper Lore")
- The world's magic lore document if the character will hold any magical role, training, or affiliation — magic systems are typically gendered or culturally specific
- Existing entries in `tabs/world-background.json`, `tabs/locations.json`, `tabs/regions.json`, `tabs/factions.json`, `tabs/npc-types.json` for any place, organization, or category the character will be tied to

Write a short **Canon notes** paragraph (2–4 sentences) at the top of this NPC's stories entry summarizing what was consulted and the load-bearing facts that constrain who this character can be — race cultural shape, gendered crafts, regional politics, established institutions, central plot positions. This is the audit trail; the orchestrator and creator must be able to see what the character was grounded in.

Do not invent institutions, titles, or categories canon does not support. If grounding reveals that the intended archetype cannot exist in this world (a magical role of the wrong gender, a profession the race does not practice, an institution that does not exist), reshape the character before continuing.

### 1. Inspiration archetype

Name a specific character from fiction this NPC is modeled on — one or two sentences. Not a category ("a wise mentor"), but a named character from a novel, film, series, play, or game. The reference is a tuning fork, not a copy — it tells the writer the *voice*, *worldview*, and *register* this character will carry. State the archetype, then in one phrase the trait of theirs to inherit.

Reach across genres — fantasy, crime, period drama, literary fiction, anime, theatre. Do not anchor to one source.

### 2. Race, age, gender

One terse line. Race from Hedoria's roster (human ethnicity, Hofnar, Draklid, Cephalen, Threshi, Fernwarg, Raknid, Prime, Molvar, Quelled, Skellach, Vorok). Age in years (or life-stage for races that do not count in human years). Gender. Nothing else here.

### 3. Background story

One paragraph (~120–180 words). Where they came from. The events and people that shaped them. The wound, the lesson, the formative pressure. Cause-and-effect prose — *because X happened, they became Y*. End the paragraph at the moment the present begins.

### 4. Personality

One paragraph (~120–180 words). Who they are *now*, given that backstory. Voice and register. Contradictions they carry. What you would remember after meeting them. Where their attention sits when they are not pretending. The archetype from step 1 should be visibly present here.

### STOP — Return the four sections and await approval

After writing the four sections, return to the orchestrator with the archetype, race-age-gender line, and both paragraphs verbatim, and **stop**. Do not write to `candidates/npcs.json`. Do not fill schema fields. The creator must approve the prose foundation before the schema is pressed from it. If you proceed without that explicit approval, the work is rejected.

### Only after approval — press the prose into the schema

When approval arrives, the schema entry is derived from the four sections. `basicInfo` distills personality and background into keyword fragments. `visualDescription` renders the body and face implied by race, age, gender, and personality. `hiddenInfo` extracts the desires and secrets the backstory and personality surface. If the schema entry says something the four sections did not earn, return to the prose first.

## Required Fields

| Field | Requirement |
|-------|-------------|
| `name` | Must match object key exactly |
| `type` | Use existing npcType when it fits, otherwise `"<your unique type>"` for truly unique NPCs, but most should fit |
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

*Personality:* [default manner], [what changes under pressure], [social calibration], [deflection or openness], [one real competence]

*Background:* [current situation as hook], [one local relationship as hook], [active want], [strong stance or opinion]

*Combat:* [style + range], [escalation/withdrawal cue], [one signature tactical habit]

**Target: 100-200 words total** across all four sub-sections. If a clause has subject-verb-object-narration shape, rewrite as phrase fragments. If a phrase welds the character to one location (encyclopedic-knowledge-of-X-corridors, knows-every-rotation-of-the-Y-guard), generalize it (palace-insider, guard-savvy). Active wants only; no internal feelings the player cannot see (no "what surfaces in his mind", no "the calm itself solves problems"). Historical relationships are one token only (widowed / divorced / never-paired).

(Race-specific physiology cues where unusual: Draklid horn-spread, Hofnar mane-cycle-tally, Vorok tusk-character, Threshi chitin-coloration, Cephalen scalp-tentacles, Fernwarg mane-trophy, Raknid pale-silk mantle, Prime relic-display, Molvar root-coloration.)

## visualDescription Format

**Four key phrase sections.** First part: establish the race's fundamental physical nature — for non-human races, copy in the body-plan descriptor from the table below, then add this individual's build, colouring, and one distinguishing physical detail. Second part: the face — paint it as a face, not a feature-list. Eyes, hair, mouth, jaw, nose, yes, but also whatever marks this face as this person's: expression-set, scars, beard if present, distinguishing marks. What you'd remember after meeting them. Third part: the body, all of it — as a chronicler describing a real naked person standing in front of them. Frame, the visible surfaces that make this body distinctively theirs: shoulders, breasts or chest, waist, hips, ass, thighs, hands, body hair, skin condition, sexual anatomy in plain words (cock and balls on men, breasts and lips and pubis on women) at the same register as the rest. A body you'd recognise. Fourth part: clothing/gear plus one sensory-specific hook that makes this NPC unmistakable. Sentence fragments and noun-phrases are fine; no narrative.

**Race body-plan descriptors** — use as the opening anchor for non-human NPCs:

| Race | Body-plan |
|------|-----------|
| Hofnar | equine-humanoid; tall, mane-haired, hoof-toed, slight muzzle |
| Draklid | drake-descended; lean, sinewy, digitigrade, scaled, fan-horned, long active tail |
| Cephalen | cephalopod-humanoid; soft near-boneless, color-shifting pearl-slate skin, scalp-tentacles |
| Threshi | locust-mantis; tall narrow chitin-plated body, compound eyes, folding mandibles, wing-panels |
| Fernwarg | wolf-fern; digitigrade, wolf-faced, fern-frond layered fur coat, spinal mane |
| Raknid | spider-humanoid; pale chitin, two human arms plus two jointed lower spider-legs, silk scalp-mantle |
| Prime | bear-bodied; tall, heavy, dense white fur, lion-muzzled chimp-face, long furry tail |
| Molvar | root-people; low quadrupedal body, two stubby upper arms, rind-skin in browns/ochres |
| Quelled | livestock-derived; pig/cow/sheep/fowl lineage, strongly animal in feature |
| Skellach | forest-giant; nine feet, oxen-legged, heavy build |

For human, Kelmari, Nadorim, and Udorathi NPCs, race cues are ethnic — colouring, build, distinctive features — not body-plan anchors.

## hiddenInfo Format

Two labeled blocks in this order: **Desire, Secrets**. Everything observable — identity, personality, background, combat — lives in `basicInfo`. hiddenInfo holds only what is actually hidden until the right scene surfaces it.

Format: `"Desire: ...\n\nSecrets: ..."`

**Minimal but salient. Keyword phrases, not prose.** Comma-separated `[modifier] [noun]` fragments. Both blocks are read by an LLM at play-time, not by a human; pack signal, do not narrate. No subject-verb-object sentences. No restating of facts already in `basicInfo`. Cut anything that does not earn its place — if a phrase would not change what the character does in a scene, it does not belong.

**No formulaic phrasings repeated across the roster.** Each NPC's content must read distinctively. If two NPCs would have used the same opener or the same "resigned old person" shape, both are wrong — rewrite. Keep it interesting and varied, avoid passive and unengaging traits.

**Every block must give the runtime LLM something the player can interact with.** Describe active wants. Avoid internal feelings the player cannot see — old griefs, private memories, people they still think about; the LLM cannot surface them as gameplay.

**Historical relationships get a one-word footnote at most** (widowed, divorced, never-paired). Do not elaborate on past partners, old loves, or losses. Describe the active present instead.

### Desire — three sentences of high signal details about their desires.

Format: descriptive phrases, without narration. **Name what the character wants in terse plain language the way a wikipedia chronicler in this world might describe a person's appetites** — describe the wanting itself, in period-appropriate vocabulary. No euphemisms, no coy indirection. Avoid modern psychology and internet-era category labels in favour of descriptive phrasing about the act, partner, or configuration desired.

The register to match, with the range expected across a roster:
- *"fantasises about being taken against her will"*
- *"dreams of being watched during the act"*
- (man) *"looks for a likely mark for sexual relief"*
- *"wants to be commanded and used like a servant"*
- *"hungers after older people"*
- *"wants to be struck and marked"*
- *"fantasises about other races"*
- *"wants to be beneath a powerful beast"*
- (man) *"longs to own a partner outright, body and silence"*
- (woman) *"is drawn to her cousin and refuses to act on it"*
- (woman) *"craves being taken in open places where she could be seen"*

Match that register.

Address each dimension — preference/fantasy may be `no particular preference` where none fits:
- **Sexdrive** (low / moderate / high / insatiable / compulsive)
- **Orientation** (narrow / broad / shifting / exclusively-X)
- **Preference or fantasy (optional)** — a specific thing the character wants in bed, written as a descriptive phrase in period-appropriate language at the register shown above. The test: would this change what they seek or do?  Reserve a described preference for the minority where it adds a real hook. Describe the wanting itself, not a category-label.
- **Pursuit style** how they approach desire (predatory / transactional / romantic / opportunistic / passive-receptive / coercive / seductive / manipulative / mixed)
- **History shape** short description  with words like (unremarkable / scandalous / exotic / traumatic / late-bloomer / abusive / exploitative etc.)

**Forced variance across the roster.** No two NPCs should land on the same dimension-combo. 

### Secrets — keyword phrases, not prose

Format: comma-separated `[noun] [detail]` fragments — the same terse keyword-phrase shape as `basicInfo` and Desire. **2-4 secrets per NPC is the norm.** Only write `"None"` for genuinely transparent characters (rare — most people are hiding something).

Each secret is a bare fact: what it is, loosely defined. No narrative, no cause-and-effect chain, no explanation of how it came to be. If it reads like a sentence, rewrite it as a fragment. Avoid knowledge secrets, stick to deeds or personal secrets.

**Wrong** (narrative): "holds in coat lining the actual falsified Iron-Step report, knows who forged it, has not reported because the man saved his life"
**Right** (keyword phrase): "Betrayed a close friend", "killed their previous partner", "closet gay" etc. 

**Target: under 25 words** across all secrets.

Draw from the full range — nothing is off-limits:
- [Past crime: murder, theft, arson, poisoning, fraud]
- [Forbidden liaison: affair, incest, cross-species, with an enemy]
- [Hidden allegiance or double-dealing]
- [Active lie or false identity they maintain]
- [Addiction: substance, gambling, sexual compulsion]
- [Debt, blackmail leverage held or owed]
- [Illegitimate children, secret heirs]
- [Betrayal: sold out a friend, collaborated with an enemy]

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
