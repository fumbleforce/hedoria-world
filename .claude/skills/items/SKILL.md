---
name: items
description: Schema and rules for creating items
context: fork
agent: items
---

# Items

Edit `tabs/items.json`.

## Required Fields

| Field | Requirement |
|-------|-------------|
| `name` | Must match object key exactly |
| `category` | Must be in itemSettings.itemCategories (armor, consumable, etc.) |
| `description` | Brief flavor text describing the item's appearance and nature. **For equippable gear (Armor/Weapon/Tool with a slot), prefix with a rarity bracket: `[Common]`, `[Uncommon]`, `[Rare]`, `[Epic]`, or `[Legendary]`** — e.g. `"[Rare] A staff of heartwood..."`. Mirrors the `[Tier 1] [Common]` convention used in npc-types/bestiary entries. Consumables, Currency, and Readables omit the prefix. |
| `bonuses` | Array of bonuses - use `[]` if item is not equipable |

## Conditional Fields

| Field | When to Include |
|-------|-----------------|
| `slot` | Required for equippable items |
| `mediaContent` | Required for readable items - the text content to display |

## Never Include

Omit these fields (calculated at runtime):
- `uuid`, `quantity`, `equippedSlot`

## Item Types

### Armor
- `category: "Armor"`, slot must be one of: `"head"`, `"body"`, `"legs"`, `"feet"`, `"hands"`
- Use bonuses to define defensive stats

### Weapon
- `category: "Weapon"`, slot must be `"mainHand"` or `"offHand"`
- Two-handed weapons (bows, two-handed swords, polearms) occupy `"mainHand"`; the description should state they require both hands and the off-hand stays empty
- Use bonuses to define offensive stats and skill/attribute boosts

### Tool
- `category: "Tool"`, slot may be `"offHand"` (for kits, grimoires, foci held in hand) or `"trinket"` (for worn accessories: charms, bandoliers, relics, rings, amulets)
- Trinket slot has quantity 2; up to two trinkets equipped simultaneously

### Consumables
- `category: "Consumable"`, no slot
- Always `bonuses: []`

### Currency
- `category: "Currency"`, no slot
- Must match `itemSettings.currencyName` for stacking
- Always `bonuses: []`

### Readable
- `category: "Readable"`, no slot
- Include `mediaContent` with the text to display
- Always `bonuses: []`

## bonuses Format

Array of stat modifications applied when item is equipped.

```typescript
{ type: "stat", variable: "damage", value: 5 }     // +50% damage
{ type: "attribute", variable: "strength", value: 2 }  // +2 to attribute
{ type: "skill", variable: "stealth", value: 1 }   // +1 to skill
{ type: "resource", variable: "health", value: 10 }  // +10 max health
```

Format: `{ type: "stat" | "attribute" | "skill" | "resource", variable: string, value: number }`

## Schema

```typescript
interface ItemDefinition {
  name: string
  category: string
  description: string
  bonuses: ItemBonus[]
  slot?: string
  mediaContent?: string
}

interface ItemBonus {
  type: 'resource' | 'stat' | 'attribute' | 'skill'
  variable: string
  value: number
}
```

## Reference

For detailed documentation, see [items-reference.md](references/items-reference.md).
