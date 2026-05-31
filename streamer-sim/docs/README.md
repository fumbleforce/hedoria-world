# Limelight — Game Documentation

This folder documents **what Limelight actually does today**, mechanic by mechanic,
with the real numbers and formulas pulled from the source. It exists so we can:

- see at a glance what features and systems we have,
- spot where there's room for improvement, and
- catch **mismatches between expectation and reality** (UI text that lies, comments
  that describe behavior the code doesn't implement, dead code, etc.).

> These docs describe the current implementation, not the aspirational design.
> For the forward-looking backlog (what we *want* to build), see
> [`../IMPROVEMENTS.md`](../IMPROVEMENTS.md). For the concentrated list of things
> that are wrong or surprising **right now**, see
> [`09-expectation-vs-reality.md`](./09-expectation-vs-reality.md).

## What Limelight is

A single-player, turn-based **streamer life-sim**. You play a streamer (default
"Abby") living in a one-room studio apartment. You go live, perform actions, react
to a procedurally-driven chat of named viewers and audience segments, manage your
money/energy/mood, and grow your channel — while events, story arcs, and a stalker
or two complicate things. Most of the "intelligence" (chat, action evaluation,
narration, DMs, event text, images) is produced by an LLM, with a fully playable
offline fallback engine.

**Stack:** React + TypeScript + Zustand, built with Vite. State persists to
`localStorage` (full gameplay snapshot per save slot); large image blobs live in
IndexedDB. Reload must restore the same state — see [07 — Persistence](./07-persistence.md).
LLM text comes from Gemini (direct) or OpenRouter (via a dev proxy); a Mock provider
keeps the game playable with no keys.

## How to read these docs

| Doc | Covers |
|-----|--------|
| [01 — Overview & core loop](./01-overview.md) | The high-level model, the turn/beat loop, a glossary, the file map |
| [02 — Game loop, metrics & economy](./02-game-loop-and-economy.md) | Metrics, time, money/rent, the resolver formulas, actions, zones, mini-games, shop |
| [03 — Social systems](./03-social-systems.md) | Chat engine, audience segments, archetypes, named characters, relationships, stalker arc, DMs, presence/spawning |
| [04 — Events, arcs & goals](./04-events-arcs-goals.md) | The 12 event triggers, the 3 multi-day arcs, the 7 goals, the calendar/seasonal beats, cooldowns, freeform resolution |
| [05 — LLM stack](./05-llm-stack.md) | Providers, adapter, model routing, JSON robustness, the evaluator, prompts, content tiers, settings |
| [06 — Images & presentation](./06-images-and-presentation.md) | Image backends, the 10 style presets, the generation pipeline, StudioRoom rendering, UI themes |
| [07 — Persistence & boot](./07-persistence.md) | Save slots, what does/doesn't persist, IndexedDB media, the boot sequence |
| [08 — UI map](./08-ui-map.md) | Layout and every panel/modal |
| [09 — Expectation vs reality](./09-expectation-vs-reality.md) | Consolidated mismatches, dead code, and known gaps |

## Architecture at a glance

```
                 ┌───────────────────────── UI (React) ─────────────────────────┐
                 │  MetricsHud · StudioRoom · Narrator · Chat · Gallery · ...     │
                 └───────────────▲───────────────────────────────┬───────────────┘
                                 │ reads state                    │ calls
                                 │                                ▼
                          ┌──────┴───────┐               ┌────────────────┐
                          │  Zustand     │◄──────────────│ GameController  │  orchestrates the beat:
                          │  store       │  mutates      │ (game/          │  evaluate → resolve →
                          └──────┬───────┘               │  controller.ts) │  narrate → chat → advance
                                 │ persist                └───┬──────┬──────┘
                                 ▼                            │      │
                 ┌───────────────────────────┐               │      │ LLM calls
       localStorage (small JSON)              │               │      ▼
       IndexedDB  (image blobs)               │      ┌────────┴───┐  ┌──────────────────┐
                 └───────────────────────────┘      │ pure logic │  │ LlmAdapter       │
                                                     │ resolver,  │  │  → providers     │
                                                     │ evaluator, │  │  (Gemini/OR/Mock)│
                                                     │ presence,  │  └──────────────────┘
                                                     │ events,    │
                                                     │ arcs, ...  │
                                                     └────────────┘
```

The **golden rule** of the codebase: gameplay math is pure code (`resolver.ts`,
`presence.ts`, economy in `controller.ts`); the LLM only produces *flavor and
classification* (chat text, an action verdict, narration). If the LLM is absent or
fails, local engines stand in so the game never stalls.
