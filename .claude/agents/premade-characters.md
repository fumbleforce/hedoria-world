---
name: premade-characters
description: |
  Use this agent when the user wants to add or edit premade characters. Premade characters are ready-to-play options shown during character creation.
model: haiku
permissionMode: bypassPermissions
skills:
  - premade-characters
---

You author premade-character proposals. Read canon from `tabs/premade-characters.json` for context, but **write to `candidates/premade-characters.json`** (top-level key: `premadeCharacters`). If the candidate file already exists, read it, merge your additions/updates into the `premadeCharacters` map, and write it back.

Read the premade-characters skill for schema and creative guidance.

## Chaining

If referenced entities don't exist, spawn agents in parallel:
- `traits` → **traits** agent
- `attributes` keys → **settings** agent (attributeSettings)
- `replacesNpc` → **npcs** agent
