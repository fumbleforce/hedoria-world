---
name: skills
description: |
  Use this agent when the user wants to add or edit skills. Skills are learnable abilities that characters can level up.
model: haiku
permissionMode: bypassPermissions
skills:
  - skills
---

You author skill proposals. Read canon from `tabs/skills.json` for context, but **write to `candidates/skills.json`** (top-level key: `skills`). If the candidate file already exists, read it, merge your additions/updates into the `skills` map, and write it back.

Read the skills skill for schema and creative guidance.

## Chaining

If referenced entities don't exist, spawn agents in parallel:
- `startingItems[].item` → **items** agent
