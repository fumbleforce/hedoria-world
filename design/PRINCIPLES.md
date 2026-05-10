# Hedoria — Game Design Principles

This document captures the design principles we work to as we build Hedoria as a Voyage world. The world has two layers: **lore** (in `lore/` and the Drive corpus, the in-world content) and **canon** (in `tabs/`, the runtime game configuration). This file is for the *design decisions* that shape how new content gets shaped.

---

## Tone and register

**Mature literary, not crass or cartoonish.** Hedoria is an adult-toned medieval fantasy with sex, violence, slavery, magical extraction, and other dark themes treated matter-of-factly — but never pornographically and never sensationally. New prose for any tab or lore doc should match the register of existing canon entries (witchcraft skill description, Cooperative Filling ability, the species docs).

**No em dashes** in tab content. Use periods, commas, and semicolons. (This is enforced in the skills SKILL.md and is a stylistic choice across all canon prose.)

**No modern political/identity framing.** Avoid contemporary Earth terminology — LGBT, queer, non-binary, woke vocabulary. Use the world's own terms: paired/solo/comrade/consort. Describe what characters do, not identity labels.

**Hard age floor.** Only young-adult to old characters appear in any sexual or violent context. Never minors, never adolescents — applies to the entire character roster, not only sex scenes.

---

## Mechanical scope

**No parallel tracking systems.** When expanding a domain (combat, magic, social, carnal), ship abilities, items, traits, and at most one new resource. **Reject** new tracked counters (notoriety, body wear, per-orifice XP), multi-state progressions, in-encounter mini-games, customer-mood tracks, negotiation trees, and "X stat affects Y stat affects Z" cascades. Status effects scoped to specific abilities or items are fine — those are local, not parallel systems.

**Coherence over flavor.** Only add NPC-generation dimensions that are actionable for the mercenary-player. Politics, religion, marriage rules, succession customs — lore backdrop only, not generation knobs.

**Don't invent magic for non-casters.** Stamina is the resource for fighters, rangers, rogues, berserkers, monks, bards, druids, and the great mass of non-casters. Mana applies only to wizards. Reservoir applies only to witches. Do not give a non-caster character magical effects without a real magical tradition behind them.

**Species traits omit `startingItems`** unless something narratively weighty is proposed. Species are not wardrobe — generic cultural-marker items don't earn their slot.

**Witches and wizards are sterile.** Mana-channeling unmakes biological reproduction. Removes whole classes of plot — pregnancy mechanics, lineage politics for mage characters — and is canonical.

---

## Magic system principles

**Witches fill on a spectrum, not a binary.** The institutional default is potions distilled from extracted essence (mana-hunters extract from creatures or licensed donors, apothecaries distill, the witch buys the bottle and drinks). Cooperative Filling with a bonded wizard consort is real but increasingly old-fashioned even at the College. Wild Draw with willing non-wizard partners is the hedge-witch fallback. Forced Draw and Juicing are criminal everywhere.

**Witches are rare** in any town and most townfolk never knowingly meet one. Direct sexual fill in any form is conducted in private; a non-witch who walks in mid-act reacts with shock, fear, or hostility regardless of kingdom.

**The Queen's College is Harvard, not the only path.** Hedge-witches everywhere, mentor-and-apprentice lineages, self-taught practitioners — all real. The College is premier (best curriculum, supply network, political cover, prestige) but does not monopolize the craft.

---

## Carnal Arts mechanical layer (added in the recent design pass)

**Willpower** is a tracked resource alongside health/stamina/mana/reservoir. General mental-resistance reserve damaged by sexual pressure, fear, temptation, addiction, mind-craft, command-magic. At zero, target yields per the source-appropriate resolution.

**Carnal Arts** is a charisma-keyed utility skill covering seduction, sex-work craft, sexual combat, and the witch's carnal mana channel. Three combat tiers: Crude (no skill, anyone can use), Trained (rank ≥ 1), Master (rank ≥ 5). Witch-Carnal hybrid ability (Juicing) is the master sex-kill move and brands the practitioner as a Drawing Witch.

**Bestiary-flip creatures** (Succor, Mauler, Centaur-thane, Brood) deal Carnal-style Willpower damage to the player rather than suffer it. Some species have specific exceptions (Threshi muzzle defeats smother finishers; Cephalen detached intellect resists most sexual pressure).

---

## Canon and lore separation

**Lore (`lore/`) is in-world content** describing the world to the reader. It is preserved verbatim from Drive on import. Updates to lore happen in named passes.

**Canon (`tabs/`)** is the runtime game configuration the Voyage engine consumes. All content authored by agents flows through `candidates/` first, is reviewed, then promoted via `node .claude/scripts/merge-candidates.js`. **No agent writes to `tabs/` directly.**

When lore and canon diverge, **canon wins for gameplay** but lore is the source of truth for backstory and tone. Reconciliation is a deliberate pass, not an automatic sync.

---

## Bestiary sexual hazards

The world's bestiary includes creatures that initiate sexual violence: Mauler, Skellach, Centaur-thane, Brood, Ulk, Succor handle the rape/breed/host-implant patterns. Sylvan and Naia are the magic-trade extraction targets. The Quelled-trade is structural sexual slavery. These are part of canon and the narrator should reflect them appropriately when relevant.

---

## Process

**Interview deeply before summoning agents.** The orchestrator extracts the creator's vision through repeated questioning before any specialist agent is spawned. Each ability, NPC, or location should feel specific to Hedoria, not generic.

**Specialist agents author proposals** to `candidates/<tab-name>.json`. The orchestrator presents the actual content (key fields, prose, mechanics) to the creator and waits for explicit per-batch approval before merging. Directional greenlights authorize *spawning agents*, not merging their output.

**Memory persists across sessions.** Feedback (corrections and confirmations), project state, and external references are saved in `~/.claude/projects/-home-jorgen-repo-World-Puppeteer/memory/`. Read those before assuming.

---

## See also

- `design/TODO.md` — deferred items and follow-up work
- `.claude/CLAUDE.md` — orchestrator role and the troupe of specialist agents
- `lore/` — in-world content corpus
- `tabs/` — runtime canon

