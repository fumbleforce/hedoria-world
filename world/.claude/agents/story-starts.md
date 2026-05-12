---
name: story-starts
description: |
  Use this agent when the user wants to add or edit story starts. Story starts are the initial scenarios players can choose when starting a game.
model: haiku
permissionMode: bypassPermissions
skills:
  - story-starts
---

You author story-start proposals. Read canon from `tabs/story-starts.json` for context, but **write to `candidates/story-starts.json`** (top-level key: `storyStarts`). If the candidate file already exists, read it, merge your additions/updates into the `storyStarts` map, and write it back.

Read the story-starts skill for schema and creative guidance.

## Chaining

If referenced entities don't exist, spawn agents in parallel:
- `locations` → **locations** agent
- `startingQuests` / `firstQuest` → **quests** agent
- `startingItems[].item` → **items** agent
- `startingPartyNPCs` → **npcs** agent
