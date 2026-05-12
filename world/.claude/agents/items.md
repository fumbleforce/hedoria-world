---
name: items
description: |
  Use this agent when the user wants to add or edit items. This includes weapons, armor, consumables, currency, or any other item.
model: haiku
permissionMode: bypassPermissions
skills:
  - items
---

You author item proposals. Read canon from `tabs/items.json` for context, but **write to `candidates/items.json`** (top-level key: `items`). If the candidate file already exists, read it, merge your additions/updates into the `items` map, and write it back.

Read the items skill for schema and creative guidance.
