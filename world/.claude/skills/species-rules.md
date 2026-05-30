# Species Consistency Rules

When creating a **species** (playable race, creature type, or sentient kind), it must be defined across THREE interconnected systems to ensure world consistency.

## The Species Trinity

Every species requires:

| Component | File | Key Fields |
|-----------|------|------------|
| **NPC Type** | `tabs/npc-types.json` | `description` |
| **Trait** | `tabs/traits.json` | `description`, `quirk` |
| **World Lore** | `tabs/world-lore.json` | `text` |

## Description Alignment

Each field serves a different purpose and has a **different format**, but all share the same **lore paragraphs** as their base.

### Lore Paragraphs (Shared Base)

The lore paragraphs are identical across NPC Type `description`, Trait `description`, and Trait `quirk`. They follow this structure:

1. **Origin sentence** - How the species comes into being (transformation, born as yokai, made through ritual, etc.)
2. **Physical features** - Concrete sensory details of their appearance
3. **Reikan sentence** - "These features remain invisible to those without Reikan, though [species] may reveal them at will or find them manifesting unbidden in combat."
4. **Personality and yokai logic** - One-word personality label ("Mischievous by nature"), followed by their alien operating logic explained through concrete examples

### Field-Specific Formats

| Field | Content |
|-------|---------|
| **NPC Type `description`** | Lore paragraphs + skills (single `\n` between blocks) |
| **Trait `description`** | Lore paragraphs + skills (double `\n\n` between blocks) |
| **Trait `quirk`** | Lore paragraphs only, no skills |
| **World Lore `text`** | Narrative prose format (flowing sentence with semicolons) |

### NPC Type Description Format

Lore paragraphs, then skills appended with single newlines:

```
[lore paragraphs] They wield three signature arts:\n[SkillName]: [exact description from skills.json]\n[SkillName]: [exact description from skills.json]\n[SkillName]: [exact description from skills.json]
```

### Trait Description Format

Lore paragraphs, then skills appended with double newlines:

```
[lore paragraphs] They wield three signature arts:\n\n[SkillName]: [exact description from skills.json]\n\n[SkillName]: [exact description from skills.json]\n\n[SkillName]: [exact description from skills.json]
```

### Trait Quirk Format

Lore paragraphs only. No skills section at all. Ends after the personality/yokai logic paragraph.

### World Lore Text Format

The world lore `text` uses a **narrative prose format** with skills woven into a flowing sentence:

```
[lore paragraphs] They wield three signature arts: [SkillName], [description adapted into flowing prose]; [SkillName], [description adapted into flowing prose]; and [SkillName], [description adapted into flowing prose].
```

The skill descriptions from `tabs/skills.json` are adapted into the flowing sentence by:
- Changing first-person perspective to third-person where needed
- Adjusting sentence fragments to fit as subordinate clauses
- Preserving all content and meaning exactly

### Skill Block Format (NPC Type and Trait Description)

Skill descriptions in NPC Type `description` and Trait `description` are **verbatim copies** from `tabs/skills.json`. The format is:

```
SkillName: exact description from skills.json
```

No adaptation, no rewording. Copy the `description` field from skills.json exactly as written.

### Writing Standards

- **No em dashes** in lore paragraphs. Use commas, semicolons, and periods instead.
- **"Three signature arts"** is the standard phrase. Never use "three terrible arts" or other variants.

## Species Skills (3 Required)

Each species trait MUST include exactly **3 skills** that:

1. Reflect innate species abilities
2. Are defined in `tabs/skills.json` with type `"Innate"`
3. Follow the skill description standards: 3 sentences, effect-focused, no em dashes, no bare translation openers

### Skill Description Standards

Skills referenced by species must follow these rules:

1. **3 sentences, effect-focused** - What it does, how it works, what happens when used
2. **No em dashes** - Use periods, commas, and semicolons instead
3. **No translation labels** - Avoid opening with bare translations
4. **Weave name meanings into prose** - Fold the meaning into full sentences
5. **No species-specific details** - Skills are shared; descriptions should be generic

## NPC Species Ability Inheritance

When creating an NPC that has a species `type`, the NPC should gain the **names and descriptions** of that species' 3 skills as abilities in their `abilities` array.

### Process:

1. Look up the species in `tabs/traits.json`
2. Find the 3 skills defined for that species trait
3. Copy those skill names and descriptions into the NPC's `abilities` array
4. Add additional unique abilities specific to that individual NPC
5. Add the `\nfighting style:` summary as the final ability entry

## Required Trait Fields

Every species trait must include all of these fields:

| Field | Requirement |
|-------|-------------|
| `name` | Must match object key exactly |
| `description` | Lore paragraphs + skill blocks (double newline separated) |
| `quirk` | Lore paragraphs only (no skills) |
| `attributes` | Array of attribute modifiers |
| `skills` | Array of exactly 3 Innate skill modifiers |
| `resources` | Array of resource modifiers (can be empty `[]`) |
| `startingItems` | Array of items granted (can be empty `[]`) |
| `abilities` | Array of ability names granted (can be empty `[]`) |
| `unlockedBy` | Leave empty `[]` - NOT YET IMPLEMENTED IN UI |
| `excludedBy` | Leave empty `[]` - NOT YET IMPLEMENTED IN UI |

## Checklist for Creating a New Species

- [ ] Create NPC Type with `description` (lore paragraphs + `\n` skill blocks)
- [ ] Create Trait with all required fields (including `unlockedBy: []` and `excludedBy: []`)
- [ ] Set Trait `description` (lore paragraphs + `\n\n` skill blocks)
- [ ] Set Trait `quirk` (lore paragraphs only, no skills)
- [ ] Include exactly 3 Innate skills in the Trait
- [ ] Create World Lore entry with `text` (narrative prose format)
- [ ] Verify lore paragraphs are identical across NPC Type, Trait description, and Trait quirk
- [ ] Verify skills exist in `tabs/skills.json` with type `"Innate"`
- [ ] Verify skill descriptions follow the 3-sentence standard

## Checklist for Updating a Species Description

- [ ] Update the NPC Type `description` first (canonical source for lore paragraphs)
- [ ] Derive Trait `description` (same lore + `\n\n` skill blocks)
- [ ] Derive Trait `quirk` (same lore, no skills)
- [ ] Update World Lore `text` (narrative prose format)
- [ ] Verify no em dashes, uses "three signature arts"

## Checklist for Creating an NPC of a Species

- [ ] Set `type` to the species NPC Type key
- [ ] Copy the 3 species skills from the trait as abilities
- [ ] Add unique individual abilities
- [ ] Add fighting style summary
- [ ] Reference species features in `basicInfo` appearance sentence

## Race Voice & Cultural Pitfalls

One paragraph per race covering personality default, common author-traps, and the gendered or cultural roles that constrain who a character can be. Consult this before authoring any non-human NPC. The deeper lore in the world's Drive documents is authoritative; this section exists to prevent the most common misreadings.

**Hofnar.** Equine-humanoid steppe-traders living in painted clan-wagon-cities that migrate seasonally — no fixed capitals. Cheerful, voluble, scrupulously contract-bound — reliability is identity, and a broken contract destroys standing for generations. They are not stoic warhorses; they are loud, social, prone to laughter and song. Organized into seven Riderings led by elder councils; the continent's overland traders, neutral by reputation, allied with no one. The Quelled trade is splitting progressive and traditional clans toward open break — name a clan-stance for any Hofnar NPC.

**Draklid.** Drake-descended cliff-clan-holders in the high desert and broken plateau, long-lived (matriarchs into the fifth century). Patient, calculating, formally polite, scrupulously fair, terrifying to cheat. They are not flamboyant fire-breathers; they are quiet aristocrats. Each clan is sovereign; never been unified, openly hostile to the suggestion. Younger sons travel as mercenaries, bodyguards, and oath-bound retainers — most Draklid abroad are these. Dress in layered desert silks, gold at throat and wrists.

**Cephalen.** Cephalopod-descended, color-shifting, near-boneless. Live in half-submerged coastal cities of mother-of-pearl and worked shell. Color-control is the central cultural discipline: children are transparent, adults hold steady, masters project false emotional states with precision. *Sly as a Cephalen* and *Cephalen-honest* are continental idioms they do not deny. They took the seas by blockade two centuries ago and control all open-water trade by treaty since.

**Quelled.** Lifted from pre-Wartide human livestock — lineages: pig-quell, cow-quell, sheep-quell, fowl-quell. Strongly animal in feature; not all stand fully upright. Bred and worked as livestock across the human kingdoms outside Avenor; the agricultural foundation of human society there. Avenor abolished the trade two generations ago and grants citizenship — educated Avenorian Quelled are now a real political force, and their relationship to the unfree Quelled in the southern kingdoms is the deepest moral fracture in the world. Crude tongues where uneducated; capable of full eloquence where educated. Free Quelled elsewhere are isolated escapees — rare, hidden, short-lived.

**Molvar.** Tuber-and-root underground hobbits living in brightly-lit tunnel-networks under low earthen mounds in central meadows and forest margins. Short-lived (~60 years). Hedonists: eat, drink, brew, garden, couple prolifically; plumpness admired, fatness more so. Communal, voluble, decisions made over long meals; no ruling class, only neighborhood councils. **Genderless does not mean personality-less.** Any two can couple, either or both can produce a spud planted in family soil. They are not slow mystics; they are not eerie oracles; they are not contemplative root-priests. They are loud, warm, opinionated, sometimes lustful, sometimes greedy, sometimes petty — a full sapient people. Speak to roots and plants — coax tunnels into shape, persuade crops to thrive. Not warlike, but devastating in tunnel defense; broke human armies in the First Soul-War and have been left alone since.

**Threshi.** Locust-mantis, chitin-plated in dust-browns and sand-yellows. Strongly dimorphic: **females are larger broad-shouldered plowers and egg-layers** (shovel-forearms, clutches of 20–40 several times yearly); **males are leaner harvesters and warriors** (sickle-blade forearms — same instrument for harvest and war). Aristocratic, ruled by a warrior-king won by challenge; no king dies peacefully. Closed to outside trade. Landless males ride out after every harvest to take land and grain from the human borders — three centuries of inches has put significant former human territory under Threshi grain. **Threshi are largely antagonistic to other Hedorian peoples; do not author them as standard NPCs.** They appear as enemies, raiders, and distant antagonist factions, not as members of mixed-race rosters. Exceptions require explicit creator approval.

**Fernwarg.** Wolf-and-fern forest-people, matriarchal. **Females are larger, heavier, more muscular, with denser manes; pack-mothers lead and wear headdresses of layered fronds.** First birth is dangerous and the central passage of a female's life. **Females choose mates.** **Males cannot lead their birth-pack — the most ambitious leave to serve abroad as mercenaries, scouts, retainers.** Packs are matrilines of 12–50, organized into forest-confederations. Two voices: long-carrying howls between packs, and evening pack-laughter — a rising chittering chorus that disturbs human visitors. Share their forests with the Raknid by ancient unwritten compact. Long political dispute with the bordering human kingdoms over forest rights; pressure building toward the third soul-war.

**Raknid.** Redeemed wartide spider-folk — the brood-line that turned during the Ensoulment and fought the rest of the Wartide alongside Avenoria's allies. Six eyes, two human arms plus two long jointed clawed spider-legs, scalp grows a webbed silken mantle. No homeland; scattered small communities of dozens to a few hundred in marginal hill country and forest edges. Most Hedorians do not distinguish them from the wartide remnant: refused service, charged double, run out of towns at dusk; communities burned out and rebuilt elsewhere — they teach against returning violence. Patient work: scholars, archivists, healers, translators, the occasional witch. **Avenor's Queen's College has trained Raknid witches for over a century — witches are female; magic carries the human gendering.**

**Primes.** The elders — pre-Ensoulment, longest history of any race. Bear-bodied, dense white fur, lion-muzzled chimp-face, long furry tail. Robed in deep blue, ochre, vermilion, gold, layered with clan and lineage markings; small bone relics worn at throat, chest, wrists, belt. Live in great cliff-cut monasteries terraced into cold mountains. Practice ancestor-magic: slow, exact, unflashy — invoking specific named dead by rite and offering, drawing on chained lineages back across millennia. Excellent for knowledge, healing, divination, true-naming, untangling curses, long-time work; **useless for battle-magic.** Power is anchored: a Prime at home with full vault-access is enormously powerful; a Prime on the road, carrying only three or four portable relics, is a fraction of that. Did not fight the first Wartide alongside Avenoria; the bone-vaults still counsel preservation.

**Vorok.** Wartide-blooded miners — the continent's primary source of minerals. Bodies adapt to heavy labor over a lifetime. Tusked; deep grinding voices; casual obscene language that stands out in formal settings. Possess a supernatural ore-sense that makes them peerless prospectors. Live in deep gallery pit-towns and cliffside mining camps; no nation, only **seven great Consortium houses and dozens of lesser ones** organizing all of Vorok civilization through complex house contracts. Well integrated into continental commerce — they hold mountain tolls (the Throat consortium has held its chokepoint for two centuries), take mercenary contracts under house charter, engineer wells in cooperation with Hofnar crews, sell ore and worked metal everywhere. Internal stratification runs from seam-laborers to foremen to principals to elders; **the contract-labor system is coercive at its lower rungs** — managed breeding compounds at the largest pits, blacklisted exiles taken up as cheap labor by rival houses or driven to banditry. NPCs should reflect house-affiliation, contract-status, and the grinding cadence of their speech; they are participants in society, not isolated outsiders.

**Skellach.** Oxen-legged horned humanoid, tall as a man, knot-bearded. Solitary woodland dweller — hunts alone or in pairs in the Reach and Avenor backwoods. Eats fruit, keeps orchard-camps, takes captives back to bind with woven vine in a particular fetish ritual (releases them after, dazed but living). Speaks well, slow rural cadence; will accept fruit and cord in trade for not pressing the matter. **Skellach are creatures with personality, not a participating race; do not author as roster NPCs.** They appear as encounters in their woods, not as members of communities.

## Magic & Gendered Crafts

Magic in this world is asymmetric and gendered for humans (and for adopted races trained in the human tradition, notably Raknid via Avenor's Queen's College):

- **Witches are female.** Cannot generate mana but store it in vastly greater quantities than any man can hold. Outlawed in human kingdoms outside Avenor; respected in non-human realms. A trained witch with a full reservoir can outmatch a circle of wizards.
- **Wizards are male.** Generate a steady modest output. Trained almost entirely at the High Forum of Telinor and its lesser Forums in host kingdoms. Austere martial brotherhood; battlestaff is weapon and focus, made for each man during training and attuned over years. Forbidden women by doctrine; pair-bonds between brothers are personal and not policed. Magic is physical, channeled through the staff — force, hardening, breaking, warding — no fireballs or lightning bolts.
- **There is no such thing as a male witch or a female wizard.** Inventing one is a category error.
- Other races have their own magic systems described in their own lore documents. Prime ancestor-magic is bone-vault-anchored, drawn from chained lineages of named dead. Vorok ore-sense is innate and prospector-bound, not battle-magic. Other races' systems must be checked before authoring a magic-user of that race.

When in doubt about whether a magical role exists in a given race or place, consult the world's magic lore document before authoring.
