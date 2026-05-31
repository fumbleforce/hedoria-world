# Limelight (streamer-sim)

You are working on **Limelight** — a turn-based streamer life-sim in `streamer-sim/`.
React + TypeScript + Zustand + Vite. Gameplay math is pure code; the LLM produces
chat, narration, and action *verdicts* only.

## Core architecture

```
player action → evaluate (LLM or offline) → resolve (deterministic) → narrate + chat
```

- **Orchestration:** `src/game/controller.ts`
- **Numbers:** `src/game/resolver.ts`, `src/game/presence.ts`, economy in controller
- **LLM:** `src/llm/` (adapter + providers); never let the LLM set metric deltas directly
- **State:** `src/state/store.ts` (localStorage); images in IndexedDB (`src/persist/`)

## Documentation (required for large changes)

Implementation docs live in **`docs/`**. Read [`docs/README.md`](docs/README.md) before
touching systems you do not already know.

**Large changes must include doc updates in the same session/PR.** Treat docs as part of
the deliverable, not optional follow-up.

### Counts as large

- New system, mechanic, or player-facing feature
- Formula / economy / segment / presence changes
- LLM provider, prompt, routing, or evaluator-contract changes
- Save format or persistence changes
- New panel/modal or major UX workflow
- 3+ files changed in one subsystem (`game/`, `llm/`, `state/`, `ui/`, `persist/`)

### What to write

| Change type | Update |
|-------------|--------|
| Mechanics, loop, economy | `docs/02-game-loop-and-economy.md` |
| Chat, segments, characters, DMs | `docs/03-social-systems.md` |
| Events, arcs, goals, calendar | `docs/04-events-arcs-goals.md` |
| LLM providers, prompts, adapter | `docs/05-llm-stack.md` |
| Images, StudioRoom, themes | `docs/06-images-and-presentation.md` |
| Saves, boot, IndexedDB | `docs/07-persistence.md` |
| Panels, modals, layout | `docs/08-ui-map.md` |
| Fixed mismatch / dead code / gap | `docs/09-expectation-vs-reality.md` |
| New module or moved orchestration | `docs/01-overview.md` (+ index in `docs/README.md`) |

- Document **what the code does today** — real numbers from source, not design intent.
- Do **not** use `IMPROVEMENTS.md` for implementation docs (backlog only).
- A large change is **incomplete** until the relevant `docs/` files are updated.

## Conventions

- Minimize scope; match existing patterns in neighboring files.
- UI calls `GameController`; avoid mutating store from components except via controller/store actions.
- Offline/mock paths must keep the game playable without API keys.
- Do not import from Hedoria `engine/` — this project is standalone.

## Useful references

- Player-facing readme: [`README.md`](README.md)
- Backlog / ideas: [`IMPROVEMENTS.md`](IMPROVEMENTS.md)
- Known bugs & seams: [`docs/09-expectation-vs-reality.md`](docs/09-expectation-vs-reality.md)
