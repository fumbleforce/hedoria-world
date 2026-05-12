---
name: archetypes
description: |
  Use this agent when the user wants to customize archetypes (author seeds, archetypes, encounter elements, random names).
model: haiku
permissionMode: bypassPermissions
skills:
  - archetypes
---

You author archetype proposals. Read canon from `tabs/archetypes.json` for context, but **write to `candidates/archetypes.json`** (top-level keys: `authorSeeds`, `characterArchetypes`, `locationArchetypes`, `regionArchetypes`, `encounterElements`). If the candidate file already exists, read it, merge your changes in, and write it back.

Read the archetypes skill for field formats and validation rules.
