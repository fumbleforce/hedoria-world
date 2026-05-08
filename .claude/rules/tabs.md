---
paths:
  - "tabs/**/*.json"
  - "candidates/**/*.json"
---

# Tabs Rules

## Default: Delegate to Agents

- **By default, delegate tabs work to specialist agents.** Use the Task tool to spawn the matching agent (e.g., `npcs` agent for `tabs/npcs.json`).
- **One agent per file type.** Use the specialist that has the skill loaded (see the Troupe table in CLAUDE.md).
- **Provide complete context.** Include all details from the interview — names, descriptions, connections, secrets. The agent can't ask follow-ups in background mode.
- **Include the autonomy directive.** Always tell background agents: "Do not ask questions. Make reasonable creative decisions and proceed."

## Candidates, Not Tabs

- **No agent writes to `tabs/` directly. Ever.** Agents read canon from `tabs/<name>.json` for context, but **author proposals to `candidates/<tab-name>.json`**.
- **Filename = target tab name.** The `npcs` agent writes to `candidates/npcs.json`. The `archetypes` agent writes to `candidates/archetypes.json`. The `settings` agent writes to `candidates/settings.json`.
- **File shape: top-level keys are block names.** `candidates/npcs.json` looks like `{ "npcs": { "Alice": {...} } }`. Tabs that hold multiple blocks (e.g. `archetypes`, `traits`, `meta`, `settings`, `ai-instructions`) get multiple top-level keys in their candidate file.
- **Merge-on-write.** If the candidate file already exists, the agent reads it, merges its new entries into the existing block, and writes it back. Don't clobber another agent's proposal.
- **Updates and additions are the same operation** — both are entries keyed by name; the merger overwrites or inserts by key.
- **No invented fields.** Every field on every entry must exist in the schema. Notes for the reviewer go in the agent's reply, not in the file.

## Exception: Orchestrator Hands-On Edits

- **When the user is actively collaborating on specific, meticulous edits, the orchestrator may edit `candidates/<tab-name>.json` directly** (still not `tabs/`). This applies when the user is hands-on, guiding changes step by step, and delegation would break the flow.
- **Load the matching skill first.** Before editing a candidate for `tabs/foo.json`, invoke `Skill` with `skill: "foo"` to load the schema and rules.

## Cross-Reference Awareness

- Before spawning an agent, check whether referenced entities exist (locations, factions, NPC types, etc.) in `tabs/` OR in any pending `candidates/` file.
- If they don't exist, spawn those agents in parallel so everything resolves.
- Never reference something that hasn't been created yet without also creating it.

## After Agent Completion

- Review what the agent proposed in `candidates/<name>.json` with a discerning eye.
- Present the creation to the user with theatrical flair.
- If something looks wrong, spawn the agent again with corrections — or edit the candidate file directly if collaborating closely with the user.

## Promoting Candidates to Canon

When the creator approves the proposed changes, the orchestrator runs:

```
node .claude/scripts/merge-candidates.js                # promote all pending candidates
node .claude/scripts/merge-candidates.js npcs.json      # promote one
node .claude/scripts/merge-candidates.js --dry-run      # preview without writing
```

The script dispatches each block to the right tab, merges entries by key, and archives the candidate to `candidates/.merged/`. After promotion, run `node .claude/scripts/build.js` to rebuild `config.json`.
