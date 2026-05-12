# TODO

## 1. Items — Phase 2 Expansion

The 5 wizard staves are merged (Ash Staff, Journeyman's Staff, Master's Staff, Chapterhouse Staff, Staff of the First Spring). The full system shape was approved earlier; only the wizard-staff pilot was authored. The rest of Phase 2 still needs to be built.

### Decisions already locked in (do NOT re-litigate)

- **Rarity tiers:** Common / Uncommon / Rare / Epic / Legendary (5 tiers)
- **Bracket-prefix convention:** every equippable item description starts with `[Common]` / `[Uncommon]` / `[Rare]` / `[Epic]` / `[Legendary]`. Mirrors the bestiary `[Tier 1] [Common]` pattern.
- **Slots in `tabs/settings.json` itemSettings.itemSlots:** `head`, `body`, `legs`, `feet`, `hands` (Armor); `mainHand`, `offHand` (Weapon); `trinket` qty 2 (Tool).
- **Two-handed weapons** (bows, polearms, two-handed swords) occupy `mainHand` only; description must state the off-hand is unavailable while wielded.
- **Profession-locking** is enforced via description text + AI narrator behavior, not engine fields. Document the lock in the description (e.g. "only wizards can work staff-work through it").
- **Soft gating + profession/skill prerequisites** is the rarity-vs-level model.
- **Currency:** gold / silver / copper (1 gold = 10 silver = 100 copper). `currencyName = "gold"` in settings.json. Price guidance is in `aiInstructions.ItemGenerationAndUsage` and `aiInstructions.generateStory.custom`.
- **Witch progression:** phial-bandolier ladder (standard tier-set, in `trinket` slot) + source-binder relics (uniques, in `trinket` slot). NOT a wizard-style mainHand weapon ladder.
- **Magnitude scaling per tier (typical):** Common 1 bonus value 1; Uncommon 1–2 bonuses values 1–3; Rare 2–3 bonuses values 2–5; Epic 3–4 bonuses values 3–8; Legendary 4 bonuses values 5–15.

### To author

- [ ] **Witch phial-bandolier ladder** — 5 tiers, `trinket` slot. Apprentice single-vial belt → master 10-vial harness. Bonus types: `resource: reservoir` (capacity), maybe `skill: witchcraft`. Higher tiers may also bonus filling efficiency narratively.
- [ ] **Apothecary kit ladder** — 5 tiers, `offHand` slot, category Tool. Apprentice satchel → master apothecary case. Bonus types: `skill: alchemy`.
- [ ] **Prime ancestor-bone instruments** — 5 tiers, `mainHand` slot, profession-locked to Prime line (Prime Ancestor-Mage, Prime Warden). Lineage relics, bone-tooth charms scaling up to a Prime master's ancestor-bound staff.
- [ ] **Fighter blade ladder** — 5 tiers, `mainHand` slot. Generic — usable by any martial profession. One-handed; off-hand free for shield.
- [ ] **Hunter bow ladder** — 5 tiers, two-handed (occupies `mainHand`, description states off-hand unavailable). Bonus types: `skill: archery` if it exists, otherwise damage stat.
- [ ] **Armor ladder** — 5 tiers × 3 weights × 5 slots = **75 items**. Cloth (casters), leather (hunters/scouts/duelists), heavy (soldiers/wardens). Bonus types: defensive stats.
- [ ] **Witch source-binder relics** — ~5 unique items. Each unlocks a previously-unreachable fill source (sylvan partners directly, stagling-antler at distance, pre-Ensoulment any-source, etc.). All `trinket` slot. Each named, each with a story.
- [ ] **Unique pre-Ensoulment named items** — ~10 pieces. Found in ruins, given as quest rewards. Each with a proper name, a history, and a sentence in their description that a learned NPC can recognize. Distribute across slots; not all weapons.
- [ ] **Consumables** — ~10. Healing potions, mana potions (common + master-grade), bandages, alchemy reagents, black-source mana potion (illegal). Categories: Consumable, no slot, `bonuses: []`.

### Phase 3 (deferred — only after items exist)

- [ ] **Restore profession `startingItems`** — wizard-line traits get a Common staff, witch-line traits get a Common phial-bandolier, apothecary gets a Common kit, etc. Currently empty after the rejected-cultural-marker-items strip. Trait-by-trait pass.
- [ ] **Curated city shop inventories** — locations work. Each major city (Avenor, Telinor, Kelmar, Udorath, Nadorim, Hofnar wagon-cities, Vorok holdings) gets a stocked shop with goods matching its specialty per `ItemGenerationAndUsage`.
- [ ] **Black-market & witch-commission stock** — illegal mana phials, captive-source charms, witch-enchanted commissions. Where applicable, gated behind reputation or contact NPCs.

### Open questions (flag during the work)

- Skill `archery` — does it exist? Hunter bow ladder needs to know.
- Apothecary kit goes in `offHand` (Tool category); confirm the engine is happy with a Tool in offHand. The `ItemSlot` definition has `category: "Weapon"` for offHand; may need a second slot or a category broadening if the engine enforces.
- Bow as two-handed: engine has no built-in two-handed concept. Convention is description-only ("requires both hands; off-hand cannot be filled while wielded"). Confirm narrator honors it.

---

## 2. NPC Abilities Cleanup

Discovered during the Isavara contamination check: NPC abilities across the roster are broken. **Not investigated in detail yet.** The Isavara case showed up but the user reports it's a wider problem — "all the NPCs are broken ability-wise."

- [ ] **Audit all NPCs** for ability problems. Use `node .claude/scripts/block-tool.js list npcs` to start. Likely issues:
  - Abilities referenced by NPCs that don't exist in `tabs/abilities.json` (the abilities system was overhauled this session — old ability names may no longer match)
  - Abilities authored as inline strings in NPC entries (free-text ability descriptions) instead of referencing the abilities block by name
  - Skill or trait references baked into ability text that point at renamed/removed entities
- [ ] **Categorize the breakage** — write a brief audit document (or use the candidate-review flow) before fixing
- [ ] **Decide fix strategy:** patch in place, regenerate NPCs from scratch, or hybrid

Related context — this session renamed `Brother of Telinor` → `Wizard` and `Witch of the College` → `Witch`, and overhauled the skill/ability/resource system. NPCs predating the overhaul are likely to have stale references.

---

## 3. Candidate NPC Re-Authoring

The user noted: "we have a lot of candidate NPCs we need to redo." Specifics not captured. **Possible interpretations:**

- NPCs in `tabs/npcs.json` whose authoring predates the recent system changes (skill/ability overhaul, trait renames, currency fix) and read wrong against the current state of the world
- NPCs the user has in mind to author fresh
- NPCs in `candidates/.rejected/` or `.deferred/` that should be revisited

- [ ] **Get clarification from the user** on which NPCs need redoing and what "redo" means here (full rewrite, surgical update, fresh authoring)
- [ ] After clarification, queue the work via the `npcs` agent in batches

---

## Smaller open threads (low priority)

- **Hedge-Wizard / Hedge-Witch redundancy:** decided this session to keep them as flavor variants under the new generic Wizard/Witch traits. If overlap becomes annoying in play, revisit and either fold mechanics in + remove or keep diverging.
- **Wizard quirk** is now generic ("you think with the staff in hand..."). Witch quirk was already generic. Rerun the trait audit if anything reads off.
- **Isavara hiddenInfo** had one stray "high enough mark" → "high enough payment" fix authored as a candidate; rejected this session because the broader NPC-ability problem made the npcs candidate untrustworthy. Re-apply when doing the NPC pass (#2/#3).
- **`stuff/checklist.md`** exists empty. Project rule says it auto-creates on session start and is the canonical progress tracker (see `.claude/rules/progress-tracking.md`). Decide whether to merge this TODO.md into checklist.md or keep TODO.md separate.

---

## Process notes (for the next session)

- **Never run `merge-candidates.js` without explicit user approval.** Rule established this session; codified in `.claude/CLAUDE.md`, `.claude/rules/tabs.md`, and `.claude/skills/orchestrator/SKILL.md`. Present actual candidate content (not just summaries) before asking.
- **Use `block-tool.js` for inspection and edits.** Subcommands: `list / keys / get / find / scan / rename / delete-key / delete-field / set-field / rename-entity`. Allowlisted, candidate-aware, handles the merge script's one-level deep-merge limitation.
- **Currency is gold / silver / copper.** Don't reintroduce "marks" anywhere. Use `block-tool.js scan --word mark` to audit if in doubt.
